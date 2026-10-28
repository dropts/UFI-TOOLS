package com.minikano.f50_sms.modules.realtime

import com.minikano.f50_sms.modules.BASE_TAG
import com.minikano.f50_sms.utils.KanoLog
import io.ktor.server.routing.Route
import io.ktor.server.websocket.webSocket
import io.ktor.websocket.Frame
import io.ktor.websocket.readText
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicLong

private const val TAG = "[$BASE_TAG]_realtime"

/**
 * 服务端主动推送。
 *
 * 前端只保留一条 /api/ws 长连接，按需订阅 topic，服务端按各自节奏采样后下发；
 * 没有任何订阅者时采样循环自动停掉，对设备的查询随之归零。
 */

// 与前端 getUFIData() 中保持一致的状态字段
private const val STATUS_CMDS =
    "usb_port_switch,battery_charging,sms_received_flag,sms_unread_num,sms_sim_unread_num," +
        "sim_msisdn,dual_sim_support,sim_slot,data_volume_limit_switch,battery_value," +
        "battery_vol_percent,network_signalbar,network_rssi,cr_version,iccid,imei,imsi," +
        "ipv6_wan_ipaddr,lan_ipaddr,mac_address,msisdn,network_information,Lte_ca_status,rssi," +
        "Z5g_rsrp,lte_rsrp,wifi_access_sta_num,loginfo,data_volume_alert_percent," +
        "data_volume_limit_size,realtime_rx_thrpt,realtime_tx_thrpt,realtime_time," +
        "monthly_tx_bytes,monthly_rx_bytes,monthly_time,network_type,network_provider,ppp_status"

private const val CELL_CMDS = "neighbor_cell_info,locked_cell_info"

// 各 topic 的采样间隔（毫秒）
private val TOPIC_INTERVAL = mapOf(
    "status" to 1000L,
    "usb" to 2000L,
    "cell" to 3000L,
    "sms" to 3000L,
    "adb" to 3000L,
    "socat" to 5000L,
    "qos" to 10000L
)

class RealtimeClient(
    val id: Long,
    val out: Channel<String>,
    val topics: MutableSet<String> = ConcurrentHashMap.newKeySet(),
    // 每个客户端各存一份「上次下发的帧」，用于跳过内容未变的重复推送。
    // 必须按客户端隔离：否则后来的新连接会因全局去重而收不到当前快照。
    val lastFrame: MutableMap<String, String> = ConcurrentHashMap(),
    @Volatile var cookie: String = "",
    @Volatile var slot: Int = 0
)

object RealtimeHub {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val clients = CopyOnWriteArrayList<RealtimeClient>()
    private val seq = AtomicLong(0)
    private val lastSent = ConcurrentHashMap<String, Long>()
    private val inFlight = ConcurrentHashMap<String, Boolean>()
    private var ticker: Job? = null
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    @Volatile
    var selfPort: Int = 2333

    @Volatile
    var deviceHost: String = "127.0.0.1:8080"

    fun keyOf(topic: String, cookie: String, slot: Int): String =
        "$topic|$cookie|${if (topic == "qos") slot else 0}"

    fun clearDue(key: String) {
        lastSent.remove(key)
    }

    fun newClient(): RealtimeClient {
        val c = RealtimeClient(seq.incrementAndGet(), Channel(Channel.BUFFERED))
        clients.add(c)
        ensureTicker()
        KanoLog.d(TAG) { "客户端接入, 当前 ${clients.size} 个" }
        return c
    }

    fun remove(c: RealtimeClient) {
        clients.remove(c)
        c.out.close()
        if (clients.isEmpty()) {
            ticker?.cancel()
            ticker = null
            lastSent.clear()
            KanoLog.d(TAG) { "最后一个客户端离开，采样已停止" }
        }
    }

    private fun ensureTicker() {
        if (ticker?.isActive == true) return
        ticker = scope.launch {
            while (isActive && clients.isNotEmpty()) {
                runCatching { tick() }
                delay(250)
            }
        }
    }

    private fun due(key: String, interval: Long): Boolean {
        val now = System.currentTimeMillis()
        val last = lastSent[key] ?: 0L
        if (now - last < interval) return false
        lastSent[key] = now
        return true
    }

    private suspend fun tick() {
        val snapshot = clients.toList()
        if (snapshot.isEmpty()) return

        val wanted = LinkedHashMap<String, MutableList<RealtimeClient>>()
        snapshot.forEach { c ->
            c.topics.forEach { t ->
                val key = keyOf(t, c.cookie, c.slot)
                wanted.getOrPut(key) { mutableListOf() }.add(c)
            }
        }

        wanted.forEach { (key, targets) ->
            val parts = key.split("|")
            val topic = parts[0]
            val cookie = parts.getOrElse(1) { "" }
            val slot = parts.getOrElse(2) { "0" }.toIntOrNull() ?: 0
            val interval = TOPIC_INTERVAL[topic] ?: return@forEach
            if (!due(key, interval)) return@forEach
            if (inFlight.putIfAbsent(key, true) != null) return@forEach
            scope.launch {
                try {
                    val payload = produce(topic, cookie, slot)
                    if (payload != null) {
                        val frame = """{"type":"$topic","data":$payload}"""
                        for (c in targets) {
                            if (!c.topics.contains(topic)) continue
                            // 内容没变就不重复下发，省流量也省前端重绘。
                            // status 例外：它是首屏仪表盘的心跳，必须按固定节拍推进，
                            // 否则曲线会因为“数据没变”而停住。
                            if (topic != "status" && c.lastFrame[topic] == frame) continue
                            c.lastFrame[topic] = frame
                            c.out.trySend(frame)
                        }
                    }
                } catch (e: Exception) {
                    KanoLog.d(TAG) { "推送 $topic 失败: ${e.message}" }
                } finally {
                    inFlight.remove(key)
                }
            }
        }
    }

    private fun produce(topic: String, cookie: String, slot: Int): String? = when (topic) {
        "status" -> statusPayload(cookie)
        "cell" -> goformText("isTest=false&cmd=$CELL_CMDS", cookie)
        "sms" -> smsPayload(cookie)
        "usb" -> loopbackGet("/api/usb_status")
        "adb" -> adbPayload()
        "socat" -> socatPayload()
        "qos" -> qosPayload(slot)
        else -> null
    }

    // 短信拉取量大，直接取原始报文；是否下发给某个客户端由 tick() 里的
    // 逐客户端去重（lastFrame）判断，这里不再做全局去重——
    // 否则新连上的客户端会一直收不到当前快照。
    private fun smsPayload(cookie: String): String? {
        val query = "multi_data=1&isTest=false&cmd=sms_data_total&page=0&data_per_page=500" +
            "&mem_store=1&tags=100&order_by=order%20by%20id%20desc"
        return goformText(query, cookie)
    }

    private fun statusPayload(cookie: String): String? {
        val goform = goformText("multi_data=1&isTest=false&cmd=$STATUS_CMDS", cookie) ?: return null
        val goformObj = runCatching { json.parseToJsonElement(goform).jsonObject }.getOrNull() ?: return null
        val infoObj = runCatching { json.parseToJsonElement(baseDeviceInfoCached() ?: "{}").jsonObject }
            .getOrNull() ?: JsonObject(emptyMap())
        // 与前端 {...resData, ...deviceInfo} 的合并顺序保持一致
        val merged = buildJsonObject {
            goformObj.forEach { (k, v) -> put(k, v) }
            infoObj.forEach { (k, v) -> put(k, v) }
            // 电量字段的兼容规则原本在前端做，这里提前算好
            val battery = firstNonBlank(goformObj["battery_value"])
                ?: firstNonBlank(goformObj["battery_vol_percent"])
                ?: firstNonBlank(infoObj["battery"])
            battery?.let { put("battery", it) }
        }
        return merged.toString()
    }

    private fun firstNonBlank(v: kotlinx.serialization.json.JsonElement?): kotlinx.serialization.json.JsonElement? {
        if (v == null || v is kotlinx.serialization.json.JsonNull) return null
        val raw = v.toString().trim('"')
        return if (raw.isBlank() || raw == "null") null else v
    }

    // CPU / 内存 / 温度变化慢，1.2s 内复用同一份快照，省掉一半 /proc 读取
    @Volatile
    private var infoCache: String? = null

    @Volatile
    private var infoCacheAt: Long = 0L

    private fun baseDeviceInfoCached(): String? {
        val now = System.currentTimeMillis()
        val cached = infoCache
        if (cached != null && now - infoCacheAt < 1200) return cached
        val fresh = loopbackGet("/api/baseDeviceInfo")
        if (fresh != null) {
            infoCache = fresh
            infoCacheAt = now
        }
        return fresh ?: cached
    }

    private fun adbPayload(): String? {
        val raw = loopbackGet("/api/adb_alive") ?: return null
        val obj = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrNull() ?: return null
        val alive = obj["result"]?.toString()?.trim('"') == "true"
        return """{"alive":$alive}"""
    }

    private fun socatPayload(): String? {
        // 用专用探测接口，不再走 /api/root_shell：
        // 后者在未开启高级功能时固定返回 500，会被这里每 5s 触发一次
        val raw = loopbackGet("/api/socat_alive") ?: return null
        val obj = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrNull() ?: return null
        val alive = obj["alive"]?.toString()?.trim('"') == "true"
        return """{"alive":$alive}"""
    }

    private fun qosPayload(slot: Int): String? {
        val raw = loopbackGet("/api/AT?command=AT%2BCGEQOSRDP%3D1&slot=$slot") ?: return null
        val obj = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrNull() ?: return null
        val result = obj["result"]?.toString()?.trim('"') ?: ""
        return buildJsonObject {
            put("result", result)
            put("slot", slot)
        }.toString()
    }

    /**
     * 走本机反向代理取 goform 数据。
     *
     * 不能直连 deviceHost：那需要自己维护原厂 cookie，且未登录时会丢大量字段；
     * 而 /api/goform 这条代理链与前端 HTTP 回落完全一致，cookie 由请求头透传、
     * 为空也能拿到基础字段，未登录即可推送首屏。
     */
    private fun goformText(query: String, cookie: String): String? {
        val url = "http://127.0.0.1:$selfPort/api/goform/goform_get_cmd_process?$query" +
            "&_=${System.currentTimeMillis()}"
        val headers = if (cookie.isBlank()) emptyMap() else mapOf("Kano-Cookie" to cookie)
        return httpGet(url, headers)
    }

    private fun loopbackGet(path: String): String? =
        httpGet("http://127.0.0.1:$selfPort$path", emptyMap())

    private fun loopbackPost(path: String, body: String): String? {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL("http://127.0.0.1:$selfPort$path").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 4000
                readTimeout = 8000
                doInput = true
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
            conn.outputStream.use { it.write(body.toByteArray()) }
            val code = conn.responseCode
            (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.use { it.readText() }
        } catch (e: Exception) {
            KanoLog.d(TAG) { "loopback POST $path 失败: ${e.message}" }
            null
        } finally {
            conn?.disconnect()
        }
    }

    private fun httpGet(url: String, headers: Map<String, String>): String? {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 3000
                readTimeout = 5000
                doInput = true
                headers.forEach { (k, v) -> setRequestProperty(k, v) }
            }
            val code = conn.responseCode
            (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.use { it.readText() }
        } catch (e: Exception) {
            KanoLog.d(TAG) { "GET 失败 $url: ${e.message}" }
            null
        } finally {
            conn?.disconnect()
        }
    }
}

fun Route.realtimeModule() {
    webSocket("/api/ws") {
        val client = RealtimeHub.newClient()
        // 浏览器 WebSocket 不能自定义请求头，cookie/slot 走查询参数
        call.request.queryParameters["cookie"]?.let { client.cookie = it }
        call.request.queryParameters["slot"]?.toIntOrNull()?.let { client.slot = it }

        val writer = launch(Dispatchers.IO) {
            for (msg in client.out) {
                runCatching { send(Frame.Text(msg)) }
            }
        }

        runCatching {
            send(Frame.Text("""{"type":"hello","interval":1000}"""))
        }

        try {
            for (frame in incoming) {
                if (frame !is Frame.Text) continue
                val text = frame.readText()
                val obj = runCatching { Json.parseToJsonElement(text).jsonObject }.getOrNull() ?: continue
                val op = obj["op"]?.toString()?.trim('"') ?: ""
                obj["cookie"]?.toString()?.trim('"')?.let { if (it.isNotBlank()) client.cookie = it }
                obj["slot"]?.toString()?.trim('"')?.toIntOrNull()?.let { client.slot = it }
                when (op) {
                    "sub" -> {
                        val arrText = obj["topics"]?.toString() ?: ""
                        Regex("\"([a-z]+)\"").findAll(arrText).forEach { m ->
                            val t = m.groupValues[1]
                            if (TOPIC_INTERVAL.containsKey(t)) {
                                client.topics.add(t)
                                // 订阅后立刻出一帧，避免首屏白等一个采样周期
                                client.lastFrame.remove(t)
                                RealtimeHub.clearDue(RealtimeHub.keyOf(t, client.cookie, client.slot))
                            }
                        }
                        val list = client.topics.joinToString(",", "[", "]") { "\"$it\"" }
                        client.out.trySend("""{"type":"subscribed","topics":$list}""")
                    }
                    "unsub" -> {
                        val arrText = obj["topics"]?.toString() ?: ""
                        Regex("\"([a-z]+)\"").findAll(arrText).forEach { m ->
                            client.topics.remove(m.groupValues[1])
                        }
                    }
                    "ping" -> client.out.trySend("""{"type":"pong"}""")
                }
            }
        } catch (e: Exception) {
            KanoLog.d(TAG) { "ws 会话结束: ${e.message}" }
        } finally {
            writer.cancel()
            RealtimeHub.remove(client)
        }
    }
}
