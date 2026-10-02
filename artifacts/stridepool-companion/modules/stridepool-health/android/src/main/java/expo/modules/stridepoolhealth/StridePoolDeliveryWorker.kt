package expo.modules.stridepoolhealth

import android.content.Context
import android.webkit.CookieManager
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

class StridePoolDeliveryWorker(context: Context, parameters: WorkerParameters) :
  CoroutineWorker(context, parameters) {
  private val preferences = context.getSharedPreferences(
    StridePoolHealthModule.PREFERENCES,
    Context.MODE_PRIVATE,
  )

  override suspend fun doWork(): Result {
    if (!preferences.getBoolean(StridePoolHealthModule.KEY_ENABLED, false)) return Result.success()
    val origin = preferences.getString(StridePoolHealthModule.KEY_API_ORIGIN, null)
      ?: return Result.success()
    val cookie = sessionCookie(origin)
    if (cookie == null) {
      queueFailure("upload_failed")
      return Result.retry()
    }

    reportQueuedFailure(origin, cookie)
    val client = try {
      HealthConnectClient.getOrCreate(applicationContext)
    } catch (_: Exception) {
      queueFailure("native_read")
      reportQueuedFailure(origin, cookie)
      return Result.success()
    }

    try {
      val permissions = client.permissionController.getGrantedPermissions()
      if (HealthPermission.getReadPermission(StepsRecord::class) !in permissions ||
        HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND !in permissions
      ) {
        queueFailure("native_read")
        reportQueuedFailure(origin, cookie)
        return Result.success()
      }

      val records = readRecentSteps(client)
      for (start in records.indices step 500) {
        val batch = JSONArray()
        records.drop(start).take(500).forEach { batch.put(it) }
        postJson(
          origin,
          cookie,
          "/api/stridepool/sources/health_connect/samples",
          JSONObject().put("samples", batch),
        )
      }
      postJson(
        origin,
        cookie,
        "/api/stridepool/sources/health_connect/delivery",
        JSONObject().put("outcome", "success"),
      )
      clearQueuedFailure()
      return Result.success()
    } catch (cancelled: CancellationException) {
      throw cancelled
    } catch (_: SecurityException) {
      queueFailure("native_read")
      reportQueuedFailure(origin, cookie)
      return Result.success()
    } catch (_: Exception) {
      queueFailure("upload_failed")
      reportQueuedFailure(origin, cookie)
      return Result.retry()
    }
  }

  private suspend fun readRecentSteps(client: HealthConnectClient): List<JSONObject> {
    val end = Instant.now()
    val start = end.minus(48, ChronoUnit.HOURS)
    val samples = mutableListOf<JSONObject>()
    var pageToken: String? = null
    do {
      val response = client.readRecords(
        ReadRecordsRequest(
          recordType = StepsRecord::class,
          timeRangeFilter = TimeRangeFilter.between(start, end),
          pageSize = 500,
          pageToken = pageToken,
        ),
      )
      response.records.forEach { record ->
        val id = record.metadata.id
        samples += JSONObject()
          .put("sourceSampleId", id)
          .put("recordDate", record.startTime.atZone(ZoneId.systemDefault()).toLocalDate().toString())
          .put("steps", record.count)
          .put("startTime", record.startTime.toString())
          .put("endTime", record.endTime.toString())
          .put("recordedAt", Instant.now().toString())
          .put(
            "rawPayload",
            JSONObject()
              .put("platform", "health_connect")
              .put("id", id)
              .put("dataOrigin", record.metadata.dataOrigin.packageName),
          )
      }
      pageToken = response.pageToken
    } while (pageToken != null)
    return samples
  }

  private fun sessionCookie(origin: String): String? = try {
    CookieManager.getInstance()
      .getCookie(origin)
      ?.split(';')
      ?.firstOrNull { it.trim().substringBefore('=') == "sid" }
      ?.trim()
  } catch (_: Exception) {
    null
  }

  private suspend fun postJson(origin: String, cookie: String, path: String, body: JSONObject) {
    withContext(Dispatchers.IO) {
      val connection = (URL(origin + path).openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 20_000
        readTimeout = 20_000
        doOutput = true
        setRequestProperty("Content-Type", "application/json")
        setRequestProperty("Cookie", cookie)
      }
      try {
        connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        if (connection.responseCode !in 200..299) {
          throw IllegalStateException("StridePool rejected the background delivery.")
        }
      } finally {
        connection.disconnect()
      }
    }
  }

  private fun queueFailure(reason: String) {
    if (!preferences.getBoolean(StridePoolHealthModule.KEY_ENABLED, false)) return
    preferences.edit()
      .putString(StridePoolHealthModule.KEY_FAILURE_AT, Instant.now().toString())
      .putString(StridePoolHealthModule.KEY_FAILURE_REASON, reason)
      .apply()
  }

  private suspend fun reportQueuedFailure(origin: String, cookie: String) {
    val attemptedAt = preferences.getString(StridePoolHealthModule.KEY_FAILURE_AT, null) ?: return
    val reason = preferences.getString(StridePoolHealthModule.KEY_FAILURE_REASON, "upload_failed")
      ?: "upload_failed"
    try {
      postJson(
        origin,
        cookie,
        "/api/stridepool/sources/health_connect/delivery",
        JSONObject()
          .put("outcome", "failure")
          .put("reason", reason)
          .put("attemptedAt", attemptedAt),
      )
      clearQueuedFailure()
    } catch (_: Exception) {
      // Keep only attempt metadata; native samples are reread and uploaded on the next run.
    }
  }

  private fun clearQueuedFailure() {
    preferences.edit()
      .remove(StridePoolHealthModule.KEY_FAILURE_AT)
      .remove(StridePoolHealthModule.KEY_FAILURE_REASON)
      .apply()
  }
}