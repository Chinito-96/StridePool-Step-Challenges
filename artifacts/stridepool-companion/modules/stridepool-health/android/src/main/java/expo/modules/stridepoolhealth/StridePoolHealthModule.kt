package expo.modules.stridepoolhealth

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.StepsRecord
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.URI
import java.util.concurrent.TimeUnit

class StridePoolHealthModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("StridePoolHealth")

    AsyncFunction("configureBackgroundDelivery") { source: String, apiOrigin: String, enabled: Boolean ->
      val context = appContext.reactContext?.applicationContext
        ?: throw IllegalStateException("StridePool's Android application context is unavailable.")
      require(source == "health_connect") { "Android background sync supports Health Connect only." }

      val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
      if (!enabled) {
        preferences.edit()
          .putBoolean(KEY_ENABLED, false)
          .remove(KEY_API_ORIGIN)
          .remove(KEY_FAILURE_AT)
          .remove(KEY_FAILURE_REASON)
          .apply()
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
        return@AsyncFunction false
      }

      val uri = URI(apiOrigin)
      require(uri.scheme == "https" && !uri.host.isNullOrBlank() && (uri.rawPath.isNullOrEmpty() || uri.rawPath == "/")) {
        "A secure StridePool origin is required for background delivery."
      }
      val origin = "${uri.scheme}://${uri.host}${if (uri.port >= 0) ":${uri.port}" else ""}"
      val client = HealthConnectClient.getOrCreate(context)
      val permissions = client.permissionController.getGrantedPermissions()
      val stepPermission = HealthPermission.getReadPermission(StepsRecord::class)
      if (stepPermission !in permissions || HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND !in permissions) {
        preferences.edit()
          .putBoolean(KEY_ENABLED, false)
          .remove(KEY_API_ORIGIN)
          .apply()
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
        return@AsyncFunction false
      }

      preferences.edit().putString(KEY_API_ORIGIN, origin).putBoolean(KEY_ENABLED, true).apply()
      val request = PeriodicWorkRequestBuilder<StridePoolDeliveryWorker>(15, TimeUnit.MINUTES)
        .setConstraints(
          Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build(),
        )
        .build()
      WorkManager.getInstance(context).enqueueUniquePeriodicWork(
        WORK_NAME,
        ExistingPeriodicWorkPolicy.UPDATE,
        request,
      )
      true
    }

    AsyncFunction("markDeliverySucceeded") { source: String ->
      if (source == "health_connect") {
        val context = appContext.reactContext?.applicationContext
        context?.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
          ?.edit()
          ?.remove(KEY_FAILURE_AT)
          ?.remove(KEY_FAILURE_REASON)
          ?.apply()
      }
    }
  }

  companion object {
    const val PREFERENCES = "stridepool_health_background"
    const val KEY_ENABLED = "enabled"
    const val KEY_API_ORIGIN = "api_origin"
    const val KEY_FAILURE_AT = "pending_failure_at"
    const val KEY_FAILURE_REASON = "pending_failure_reason"
    const val WORK_NAME = "stridepool-health-connect-delivery"
  }
}