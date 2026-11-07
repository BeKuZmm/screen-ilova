package com.screenshare.pro

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.RelativeLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress
import java.net.URI

class MainActivity : AppCompatActivity() {

    // LAYOUTS
    private lateinit var layoutModeSelection: LinearLayout
    private lateinit var layoutStreamingActive: LinearLayout
    private lateinit var layoutReceiverActive: RelativeLayout
    private lateinit var layoutReceiverWaiting: LinearLayout

    // CONTROLS - MODE SELECTION
    private lateinit var btnScanQr: Button
    private lateinit var btnManualPin: Button
    private lateinit var btnOpenReceiver: Button
    private lateinit var tvHeaderStatus: TextView

    // CONTROLS - STREAMING ACTIVE
    private lateinit var tvStreamingTarget: TextView
    private lateinit var btnStopStreaming: Button

    // CONTROLS - RECEIVER ACTIVE
    private lateinit var ivReceivedScreen: ImageView
    private lateinit var btnBackFromReceiver: ImageButton
    private lateinit var tvReceiverDeviceTitle: TextView
    private lateinit var tvWaitingStreamText: TextView
    private lateinit var tvReceiverPinHint: TextView

    // MEDIA PROJECTION & CAPTURE
    private lateinit var mediaProjectionManager: MediaProjectionManager
    private var isStreaming = false
    private var targetServerIp = ""
    private var targetServerPort = 4848
    private var targetRoomPin = "777888"

    // RECEIVER SOCKET
    private var receiverSocket: Socket? = null
    private var udpDiscoveryJob: Job? = null

    // QR SCANNER LAUNCHER (ZXing)
    private val barcodeLauncher = registerForActivityResult(ScanContract()) { result ->
        if (result.contents != null) {
            val qrText = result.contents
            val (ip, port, pin) = parseQrData(qrText)
            if (ip.isNotEmpty()) {
                targetServerIp = ip
                targetServerPort = port
                targetRoomPin = pin
                Toast.makeText(this, "QR muvaffaqiyatli o'qildi: $ip:$port (PIN: $pin)", Toast.LENGTH_SHORT).show()
                requestScreenProjection()
            } else {
                Toast.makeText(this, "QR-koddan IP manzil aniqlanmadi!", Toast.LENGTH_LONG).show()
            }
        } else {
            Toast.makeText(this, "Skanerlash bekor qilindi", Toast.LENGTH_SHORT).show()
        }
    }

    // MEDIA PROJECTION LAUNCHER
    private val projectionLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            startStreamingService(result.resultCode, result.data!!)
        } else {
            Toast.makeText(this, "Ekran yozishga ruxsat berilmadi", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Viewlarni bog'lash
        layoutModeSelection = findViewById(R.id.layoutModeSelection)
        layoutStreamingActive = findViewById(R.id.layoutStreamingActive)
        layoutReceiverActive = findViewById(R.id.layoutReceiverActive)
        layoutReceiverWaiting = findViewById(R.id.layoutReceiverWaiting)

        btnScanQr = findViewById(R.id.btnScanQr)
        btnManualPin = findViewById(R.id.btnManualPin)
        btnOpenReceiver = findViewById(R.id.btnOpenReceiver)
        tvHeaderStatus = findViewById(R.id.tvHeaderStatus)

        tvStreamingTarget = findViewById(R.id.tvStreamingTarget)
        btnStopStreaming = findViewById(R.id.btnStopStreaming)

        ivReceivedScreen = findViewById(R.id.ivReceivedScreen)
        btnBackFromReceiver = findViewById(R.id.btnBackFromReceiver)
        tvReceiverDeviceTitle = findViewById(R.id.tvReceiverDeviceTitle)
        tvWaitingStreamText = findViewById(R.id.tvWaitingStreamText)
        tvReceiverPinHint = findViewById(R.id.tvReceiverPinHint)

        mediaProjectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager

        // TUGMALARNI SOZLASH
        // 1. QR Kod skanerlash
        btnScanQr.setOnClickListener {
            launchQrScanner()
        }

        // 2. PIN va IP orqali qo'lda ulanish
        btnManualPin.setOnClickListener {
            showManualConnectDialog()
        }

        // 3. Qabul qiluvchi rejim
        btnOpenReceiver.setOnClickListener {
            showReceiverDialog()
        }

        // 4. Efirni to'xtatish
        btnStopStreaming.setOnClickListener {
            stopStreamingService()
        }

        // 5. Receiver oynasidan chiqish
        btnBackFromReceiver.setOnClickListener {
            stopReceiverMode()
        }

        // UDP orqali kompyuterni fonga qidirib ko'rish
        startPassiveUdpDiscovery()
    }

    // QR-KOD SKANERNI ISHGA TUSHIRISH
    private fun launchQrScanner() {
        val options = ScanOptions().apply {
            setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            setPrompt("Kompyuter ekranidagi QR-kodni skanerlang")
            setCameraId(0)
            setBeepEnabled(true)
            setBarcodeImageEnabled(false)
            setOrientationLocked(false)
        }
        barcodeLauncher.launch(options)
    }

    // QR DATA PARSER
    private fun parseQrData(content: String): Triple<String, Int, String> {
        // 1. JSON format
        try {
            if (content.startsWith("{")) {
                val json = JSONObject(content)
                val ip = json.optString("ip", "")
                val port = json.optInt("port", 4848)
                val pin = json.optString("pin", "777888")
                if (ip.isNotEmpty()) return Triple(ip, port, pin)
            }
        } catch (e: Exception) {}

        // 2. URL format: http://192.168.1.5:4848?pin=123456
        try {
            val uri = URI(content)
            val host = uri.host
            if (!host.isNullOrEmpty()) {
                val port = if (uri.port != -1) uri.port else 4848
                val query = uri.query ?: ""
                var pin = "777888"
                if (query.contains("pin=")) {
                    pin = query.substringAfter("pin=").substringBefore("&")
                }
                return Triple(host, port, pin)
            }
        } catch (e: Exception) {}

        // 3. IP:PORT format
        if (content.contains(":")) {
            val parts = content.split(":")
            val ip = parts[0].trim()
            val port = parts[1].trim().toIntOrNull() ?: 4848
            return Triple(ip, port, "777888")
        }

        // 4. Faqat IP
        return Triple(content.trim(), 4848, "777888")
    }

    // EKRAN YUBORISH UCHUN RUXSAT SO'RASH
    private fun requestScreenProjection() {
        projectionLauncher.launch(mediaProjectionManager.createScreenCaptureIntent())
    }

    // EFIR XIZMATINI BOSHLASH
    private fun startStreamingService(resultCode: Int, data: Intent) {
        val intent = Intent(this, ScreenCaptureService::class.java).apply {
            putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, resultCode)
            putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, data)
            putExtra(ScreenCaptureService.EXTRA_SERVER_IP, targetServerIp)
            putExtra(ScreenCaptureService.EXTRA_SERVER_PORT, targetServerPort)
            putExtra(ScreenCaptureService.EXTRA_ROOM_PIN, targetRoomPin)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }

        isStreaming = true
        layoutModeSelection.visibility = View.GONE
        layoutReceiverActive.visibility = View.GONE
        layoutStreamingActive.visibility = View.VISIBLE

        tvStreamingTarget.text = "Kompyuter: $targetServerIp:$targetServerPort\nPIN: $targetRoomPin"
        tvHeaderStatus.text = "● Efir faol"
    }

    // EFIRNI TO'XTATISH
    private fun stopStreamingService() {
        val intent = Intent(this, ScreenCaptureService::class.java)
        stopService(intent)

        isStreaming = false
        layoutStreamingActive.visibility = View.GONE
        layoutReceiverActive.visibility = View.GONE
        layoutModeSelection.visibility = View.VISIBLE
        tvHeaderStatus.text = "● Tayyor"
    }

    // QO'LDA ULASH DIALOGI
    private fun showManualConnectDialog() {
        val dialogView = layoutInflater.inflate(android.R.layout.simple_list_item_1, null)
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(60, 40, 60, 20)
        }

        val etIp = EditText(this).apply {
            hint = "Kompyuter IP (masalan: 192.168.1.100)"
            setText(if (targetServerIp.isNotEmpty()) targetServerIp else "192.168.1.")
            setSelection(text.length)
        }

        val etPin = EditText(this).apply {
            hint = "6 xonali PIN (masalan: 777888)"
            setText(targetRoomPin)
        }

        container.addView(etIp)
        container.addView(etPin)

        AlertDialog.Builder(this)
            .setTitle("Qo'lda ulanish")
            .setMessage("Kompyuter ekrandagi IP va PIN kodni kiriting:")
            .setView(container)
            .setPositiveButton("Ulanish va Uzatish") { _, _ ->
                val ip = etIp.text.toString().trim()
                val pin = etPin.text.toString().trim()
                if (ip.isNotEmpty()) {
                    targetServerIp = ip
                    targetServerPort = 4848
                    targetRoomPin = if (pin.isNotEmpty()) pin else "777888"
                    requestScreenProjection()
                } else {
                    Toast.makeText(this, "IP manzilni kiriting!", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Bekor qilish", null)
            .show()
    }

    // QABUL QILISH REJIMI DIALOGI
    private fun showReceiverDialog() {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(60, 40, 60, 20)
        }

        val etIp = EditText(this).apply {
            hint = "Server IP (masalan: 192.168.1.100)"
            setText(if (targetServerIp.isNotEmpty()) targetServerIp else "192.168.1.")
            setSelection(text.length)
        }

        val etPin = EditText(this).apply {
            hint = "Xona PIN kodi (ixtiyoriy, masalan: 777888)"
            setText("777888")
        }

        container.addView(etIp)
        container.addView(etPin)

        AlertDialog.Builder(this)
            .setTitle("Ekranni Qabul Qilish")
            .setMessage("Uzatuvchi kompyuter IP manzili va PIN kodini kiriting:")
            .setView(container)
            .setPositiveButton("Ko'rishni boshlash") { _, _ ->
                val ip = etIp.text.toString().trim()
                val pin = etPin.text.toString().trim().ifEmpty { "777888" }
                if (ip.isNotEmpty()) {
                    startReceiverMode(ip, 4848, pin)
                }
            }
            .setNeutralButton("📷 QR Skaner orqali") { _, _ ->
                barcodeLauncher.launch(ScanOptions().apply {
                    setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                    setPrompt("Uzatuvchi ekranidagi QR-kodni skanerlang")
                    setBeepEnabled(true)
                })
            }
            .setNegativeButton("Bekor qilish", null)
            .show()
    }

    // QABUL QILISH REJIMINI ISHGA TUSHIRISH
    private fun startReceiverMode(ip: String, port: Int, pin: String) {
        layoutModeSelection.visibility = View.GONE
        layoutStreamingActive.visibility = View.GONE
        layoutReceiverActive.visibility = View.VISIBLE
        layoutReceiverWaiting.visibility = View.VISIBLE
        tvReceiverPinHint.text = "PIN: $pin"

        try {
            val opts = IO.Options().apply { reconnection = true }
            receiverSocket = IO.socket("http://$ip:$port", opts)
            receiverSocket?.connect()

            receiverSocket?.on(Socket.EVENT_CONNECT) {
                val joinData = JSONObject().apply {
                    put("pin", pin)
                    put("roomId", pin)
                }
                receiverSocket?.emit("join-as-receiver", joinData)
                receiverSocket?.emit("join-room", joinData)
            }

            // KADRLARNI QABUL QILISH
            val frameListener: (Array<Any>) -> Unit = { args ->
                if (args.isNotEmpty()) {
                    val data = args[0]
                    if (data is ByteArray) {
                        val bmp = BitmapFactory.decodeByteArray(data, 0, data.size)
                        if (bmp != null) {
                            runOnUiThread {
                                layoutReceiverWaiting.visibility = View.GONE
                                ivReceivedScreen.setImageBitmap(bmp)
                            }
                        }
                    }
                }
            }

            receiverSocket?.on("incoming-screen-frame") { args -> frameListener(args) }
            receiverSocket?.on("mobile-frame") { args -> frameListener(args) }

            receiverSocket?.on("stream-stopped") {
                runOnUiThread {
                    layoutReceiverWaiting.visibility = View.VISIBLE
                    tvWaitingStreamText.text = "Efir to'xtatildi"
                    ivReceivedScreen.setImageBitmap(null)
                }
            }

        } catch (e: Exception) {
            Toast.makeText(this, "Ulanishda xatolik: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    private fun stopReceiverMode() {
        receiverSocket?.disconnect()
        receiverSocket = null
        ivReceivedScreen.setImageBitmap(null)

        layoutReceiverActive.visibility = View.GONE
        layoutStreamingActive.visibility = View.GONE
        layoutModeSelection.visibility = View.VISIBLE
    }

    // PASSIV UDP QIDIRUV (Wi-Fi router ruxsat bersa avtomatik IP ni oladi)
    private fun startPassiveUdpDiscovery() {
        udpDiscoveryJob = CoroutineScope(Dispatchers.IO).launch {
            var socket: DatagramSocket? = null
            try {
                socket = DatagramSocket(null).apply {
                    reuseAddress = true
                    bind(InetSocketAddress(4847))
                }
                val buffer = ByteArray(1024)
                while (true) {
                    val packet = DatagramPacket(buffer, buffer.size)
                    socket.receive(packet)
                    val msg = String(packet.data, 0, packet.length)
                    val json = JSONObject(msg)
                    val ip = json.optString("ip", "")
                    val pin = json.optString("pin", "777888")
                    if (ip.isNotEmpty()) {
                        withContext(Dispatchers.Main) {
                            targetServerIp = ip
                            targetRoomPin = pin
                            tvHeaderStatus.text = "● Kompyuter topildi ($ip)"
                        }
                    }
                }
            } catch (e: Exception) {
                // Tarmoqda UDP bloklangan bo'lsa indamay o'tadi
            } finally {
                socket?.close()
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        udpDiscoveryJob?.cancel()
        receiverSocket?.disconnect()
    }
}
