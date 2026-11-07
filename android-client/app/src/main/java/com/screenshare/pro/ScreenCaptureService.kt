package com.screenshare.pro

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.util.Base64
import androidx.core.app.NotificationCompat
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.ByteArrayOutputStream

class ScreenCaptureService : Service() {

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var socket: Socket? = null
    private var streamJob: Job? = null

    private var handlerThread: HandlerThread? = null
    private var backgroundHandler: Handler? = null

    companion object {
        const val CHANNEL_ID = "ScreenCaptureServiceChannel"
        const val NOTIFICATION_ID = 101

        const val EXTRA_RESULT_CODE = "RESULT_CODE"
        const val EXTRA_RESULT_DATA = "RESULT_DATA"
        const val EXTRA_SERVER_IP = "SERVER_IP"
        const val EXTRA_SERVER_PORT = "SERVER_PORT"
        const val EXTRA_ROOM_PIN = "ROOM_PIN"

        const val ACTION_STREAM_CONNECTED = "com.screenshare.pro.STREAM_CONNECTED"
        const val ACTION_STREAM_FAILED = "com.screenshare.pro.STREAM_FAILED"
        const val ACTION_STREAM_STOPPED = "com.screenshare.pro.STREAM_STOPPED"

        fun parseHostAndPort(rawInput: String, defaultPort: Int = 4848): Pair<String, Int> {
            var clean = rawInput.trim()
            if (clean.startsWith("http://", ignoreCase = true)) clean = clean.substring(7)
            if (clean.startsWith("https://", ignoreCase = true)) clean = clean.substring(8)
            clean = clean.substringBefore("/")

            var host = clean
            var port = defaultPort

            if (clean.contains(":")) {
                val parts = clean.split(":")
                host = parts[0].trim()
                val p = parts[1].trim().toIntOrNull()
                if (p != null && p in 1..65535) {
                    port = p
                }
            }
            return Pair(host, port)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        createNotificationChannel()

        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("ScreenShare Pro")
            .setContentText("Telefon ekrani kompyuterga uzatilmoqda...")
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, 0) ?: 0
        val resultData = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent?.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent?.getParcelableExtra<Intent>(EXTRA_RESULT_DATA)
        }

        val rawServerIp = intent?.getStringExtra(EXTRA_SERVER_IP) ?: ""
        val roomPin = intent?.getStringExtra(EXTRA_ROOM_PIN) ?: "777888"

        if (resultCode != 0 && resultData != null && rawServerIp.isNotEmpty()) {
            val (host, port) = parseHostAndPort(rawServerIp)
            connectSocketAndStartStreaming(resultCode, resultData, host, port, roomPin)
        } else {
            stopSelf()
        }

        return START_NOT_STICKY
    }

    private fun connectSocketAndStartStreaming(
        resultCode: Int,
        resultData: Intent,
        host: String,
        port: Int,
        roomPin: String
    ) {
        // Fon oqimini Looper bilan yaratish (ImageReader xabarlari uchun shart!)
        handlerThread = HandlerThread("ScreenCaptureLoop").apply { start() }
        backgroundHandler = Handler(handlerThread!!.looper)

        streamJob = CoroutineScope(Dispatchers.IO).launch {
            try {
                val opts = IO.Options().apply {
                    reconnection = true
                    timeout = 10000
                }
                val socketUrl = "http://$host:$port"
                socket = IO.socket(socketUrl, opts)
                socket?.connect()

                socket?.on(Socket.EVENT_CONNECT) {
                    val joinData = JSONObject().apply {
                        put("pin", roomPin)
                        put("roomId", roomPin)
                        put("deviceName", Build.MODEL ?: "Android Telefon")
                    }
                    socket?.emit("join-as-sender", joinData)
                    socket?.emit("join-room", joinData)

                    sendBroadcast(Intent(ACTION_STREAM_CONNECTED).setPackage(packageName))
                }

                socket?.on(Socket.EVENT_CONNECT_ERROR) { args ->
                    val err = if (args.isNotEmpty()) args[0].toString() else "Ulanish xatosi"
                    val failIntent = Intent(ACTION_STREAM_FAILED).apply {
                        setPackage(packageName)
                        putExtra("ERROR_MSG", err)
                    }
                    sendBroadcast(failIntent)
                }

                val projectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
                mediaProjection = projectionManager.getMediaProjection(resultCode, resultData)

                mediaProjection?.registerCallback(object : MediaProjection.Callback() {
                    override fun onStop() {
                        stopSelf()
                    }
                }, Handler(Looper.getMainLooper()))

                val metrics = resources.displayMetrics
                val screenWidth = metrics.widthPixels
                val screenHeight = metrics.heightPixels
                val density = metrics.densityDpi

                val targetWidth = 720
                var targetHeight = (720f * (screenHeight.toFloat() / screenWidth.toFloat())).toInt()
                if (targetHeight % 2 != 0) targetHeight += 1

                imageReader = ImageReader.newInstance(targetWidth, targetHeight, PixelFormat.RGBA_8888, 3)

                virtualDisplay = mediaProjection?.createVirtualDisplay(
                    "ScreenShareDisplay",
                    targetWidth,
                    targetHeight,
                    density,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                    imageReader?.surface,
                    null,
                    backgroundHandler
                )

                var lastFrameTime = 0L
                val frameInterval = 1000L / 30L // 30 FPS

                imageReader?.setOnImageAvailableListener({ reader ->
                    val image = reader.acquireLatestImage() ?: return@setOnImageAvailableListener
                    val now = System.currentTimeMillis()
                    if (now - lastFrameTime < frameInterval) {
                        image.close()
                        return@setOnImageAvailableListener
                    }
                    lastFrameTime = now

                    try {
                        val planes = image.planes
                        val buffer = planes[0].buffer
                        val pixelStride = planes[0].pixelStride
                        val rowStride = planes[0].rowStride
                        val stridePixels = rowStride / pixelStride

                        val bitmap = Bitmap.createBitmap(
                            stridePixels,
                            targetHeight,
                            Bitmap.Config.ARGB_8888
                        )
                        bitmap.copyPixelsFromBuffer(buffer)

                        val finalBitmap = if (stridePixels > targetWidth) {
                            Bitmap.createBitmap(bitmap, 0, 0, targetWidth, targetHeight)
                        } else {
                            bitmap
                        }

                        val baos = ByteArrayOutputStream()
                        finalBitmap.compress(Bitmap.CompressFormat.JPEG, 65, baos)
                        val jpegBytes = baos.toByteArray()
                        val base64Data = "data:image/jpeg;base64," + Base64.encodeToString(jpegBytes, Base64.NO_WRAP)

                        if (socket?.connected() == true) {
                            socket?.emit("screen-frame", base64Data)
                            socket?.emit("mobile-frame", base64Data)
                        }

                        if (finalBitmap != bitmap) {
                            finalBitmap.recycle()
                        }
                        bitmap.recycle()
                    } catch (e: Exception) {
                    } finally {
                        image.close()
                    }
                }, backgroundHandler)

            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        streamJob?.cancel()
        try {
            virtualDisplay?.release()
            imageReader?.close()
            mediaProjection?.stop()
        } catch (e: Exception) {}

        handlerThread?.quitSafely()
        handlerThread = null
        backgroundHandler = null

        socket?.emit("stop-stream")
        socket?.emit("stop-streaming")
        socket?.disconnect()

        sendBroadcast(Intent(ACTION_STREAM_STOPPED).setPackage(packageName))
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val serviceChannel = NotificationChannel(
                CHANNEL_ID,
                "Screen Capture Service",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(serviceChannel)
        }
    }
}
