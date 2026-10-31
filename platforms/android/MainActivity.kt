package cz.attosoft.atv

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView

/**
 * Hosts the aTV web build (copied to assets/www by `npm run build:android`) and gives it
 * window.AtvBridge for launching other apps. A starting point for an Android Studio project
 * (Empty Activity, minSdk 21) together with AndroidManifest.xml next to this file.
 */
class MainActivity : Activity() {
    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.allowFileAccess = true
        web.addJavascriptInterface(Bridge(), "AtvBridge")
        web.loadUrl("file:///android_asset/www/index.html")
        setContentView(web)
    }

    inner class Bridge {
        /** Starts the app's TV (leanback) activity, falling back to its phone launcher. */
        @JavascriptInterface
        fun launch(packageName: String): Boolean {
            val intent = packageManager.getLeanbackLaunchIntentForPackage(packageName)
                ?: packageManager.getLaunchIntentForPackage(packageName)
                ?: return false
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent)
            return true
        }

        /** Opens a web page in the device's browser. */
        @JavascriptInterface
        fun openUrl(url: String): Boolean {
            if (!url.startsWith("http://") && !url.startsWith("https://")) return false
            val intent = Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (intent.resolveActivity(packageManager) == null) return false
            startActivity(intent)
            return true
        }

        @JavascriptInterface
        fun exit() {
            runOnUiThread { finish() }
        }
    }
}
