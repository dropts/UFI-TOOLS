package com.minikano.f50_sms.modules.auth

import android.content.Context
import com.minikano.f50_sms.utils.KanoLog
import com.minikano.f50_sms.utils.KanoUtils
import com.minikano.f50_sms.utils.KanoUtils.Companion.normalizeLeadingSlashes
import com.minikano.f50_sms.utils.KanoUtils.Companion.normalizePath
import io.ktor.server.application.ApplicationCall
import io.ktor.server.request.httpMethod
import io.ktor.server.request.path
import io.ktor.server.request.queryString

object KanoAuth {
    val PREFS_NAME = "kano_ZTE_store"
    val PREF_LOGIN_TOKEN = "login_token"
    val PREF_TOKEN_ENABLED = "login_token_enabled"
    val REQUEST_SECRET_KEY = "minikano_kOyXz0Ciz4V7wR0IeKmJFYFQ20jd"

    val apiWhiteListExact: Set<String> = setOf(
            "/api/get_custom_head",
            "/api/version_info",
            "/api/need_token",
            "/api/get_theme",
            "/api/SELinux"
        )

    val apiWhiteListPrefix: List<String> = listOf(
        "/api/uploads"
    )

    /**
     * UFI-TOOLS 口令鉴权已移除。
     *
     * 现在登录只依赖中兴后台密码（由前端登录流程直接校验），
     * 因此这里对所有请求直接放行，不再校验 authorization / kano-t / kano-sign。
     */
    fun checkAuth(call: ApplicationCall, context: Context): Boolean {
        return true
    }
}
