package com.screenshare.pro

import android.app.Activity
import android.app.AlertDialog
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.BitmapFactory
import android.media.projection.MediaProjectionManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
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

    // LAYOUTLAR
    private lateinit var layoutModeSelection: LinearLayout
    private lateinit var layoutStreamingActive: LinearLayout
    private lateinit var layoutReceiverActive: RelativeLayout
    private lateinit var layoutReceiverWaiting: LinearLayout

    // ASOSIY SAHIFA ELEMENTLARI
    private lateinit var btnScanQr: Button
    private lateinit var etTargetIp: EditText
    private lateinit var etTargetPin: EditText
    private lateinit var btnConnectManual: Button
    private lateinit var btnOpenReceiver: Button
    private lateinit var tvHeaderStatus: TextView

    // EFIR HOLATI ELEMENTLARI
    private lateinit var tvStreamingLiveBadge: TextView
    private lateinit var tvStreamingTarget: TextView
    private lateinit var tvStreamingPin: TextView
    private lateinit var btnStopStreaming: Button

    // QABUL QILUVCHI ELEMENTLAR
    private lateinit var ivReceivedScreen: ImageView
    private lateinit var btnBackFromReceiver: ImageButton
    private lateinit var tvWaitingStreamText: TextView

    // PROJECTION & NETWORK
    private lateinit var mediaProjectionManager: MediaProjectionManager
    private var isStreaming = false
    private var targetServerIp = "10.121.221.21"
    private var targetServerPort = 4848
    private var targetRoomPin = "777888"

    private var receiverSocket: Socket? = null
    private var udpDiscoveryJob: Job? = null

    // BROADCAST RECEIVER (Xizmat holatini tinglash)
    private val streamStatusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                ScreenCaptureService.ACTION_STREAM_CONNECTED -> {
                    tvStreamingLiveBadge.text = "🟢  JONLI EFIR UZATILMOQDA"
                    tvStreamingLiveBadge.setTextColor(0xFF10B981.toInt())
                    Toast.makeText(this@MainActivity, "Kompyuterga ulandi! Efir boshlandi.", Toast.LENGTH_SHORT).show()
                }
                ScreenCaptureService.ACTION_STREAM_FAILED -> {
                    val errorMsg = intent.getStringExtra("ERROR_MSG") ?: "Ulanish xatosi"
                    showConnectionErrorDialog(errorMsg)
                    stopStreamingService()
                }
                ScreenCaptureService.ACTION_STREAM_STOPPED -> {
                    stopStreamingService()
                }
            }
        }
    }

    // QR SCANNER LAUNCHER (ZXing)
    private val barcodeLauncher = registerForActivityResult(ScanContract()) { result ->
        if (result.contents != null) {
            val qrText = result.contents
            val (ip, port, pin) = parseQrData(qrText)
            if (ip.isNotEmpty()) {
                targetServerIp = ip
                targetServerPort = port
                targetRoomPin = pin
                etTargetIp.setText(ip)
                etTargetPin.setText(pin)
                Toast.makeText(this, "QR o'qildi: $ip (PIN: $pin)", Toast.LENGTH_SHORT).show()
                requestScreenProjection()
            } else {
                Toast.makeText(this, "QR-koddan IP manzil topilmadi!", Toast.LENGTH_LONG).show()
            }
        } else {
            Toast.makeText(this, "Skanerlash bekor qilindi", Toast.LENGTH_SHORT).show()
        }
    }

    // PROJECTION RUXSAT LAUNCHER
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

        layoutModeSelection = findViewById(R.id.layoutModeSelection)
        layoutStreamingActive = findViewById(R.id.layoutStreamingActive)
        layoutReceiverActive = findViewById(R.id.layoutReceiverActive)
        layoutReceiverWaiting = findViewById(R.id.layoutReceiverWaiting)

        btnScanQr = findViewById(R.id.btnScanQr)
        etTargetIp = findViewById(R.id.etTargetIp)
        etTargetPin = findViewById(R.id.etTargetPin)
        btnConnectManual = findViewById(R.id.btnConnectManual)
        btnOpenReceiver = findViewById(R.id.btnOpenReceiver)
        tvHeaderStatus = findViewById(R.id.tvHeaderStatus)

        tvStreamingLiveBadge = findViewById(R.id.tvStreamingLiveBadge)
        tvStreamingTarget = findViewById(R.id.tvStreamingTarget)
        tvStreamingPin = findViewById(R.id.tvStreamingPin)
        btnStopStreaming = findViewById(R.id.btnStopStreaming)

        ivReceivedScreen = findViewById(R.id.ivReceivedScreen)
        btnBackFromReceiver = findViewById(R.id.btnBackFromReceiver)
        tvWaitingStreamText = findViewById(R.id.tvWaitingStreamText)

        mediaProjectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager

        // Standart qiymatlarni o'rnatish
        etTargetIp.setText(targetServerIp)
        etTargetPin.setText(targetRoomPin)

        // Wi-Fi tekshirish
        checkNetworkStatus()

        // 1. QR Kod skanerlash
        btnScanQr.setOnClickListener {
            launchQrScanner()
        }

        // 2. To'g'ridan-to'g'ri kartadagi ULANISH tugmasi
        btnConnectManual.setOnClickListener {
            val rawIp = etTargetIp.text.toString().trim()
            val pin = etTargetPin.text.toString().trim().ifEmpty { "777888" }

            if (rawIp.isNotEmpty()) {
                val (cleanHost, cleanPort) = ScreenCaptureService.parseHostAndPort(rawIp)
                targetServerIp = cleanHost
                targetServerPort = cleanPort
                targetRoomPin = pin
                requestScreenProjection()
            } else {
                Toast.makeText(this, "Iltimos, kompyuter IP manzilini kiriting!", Toast.LENGTH_SHORT).show()
            }
        }

        // 3. Ekranni telefonda qabul qilish
        btnOpenReceiver.setOnClickListener {
            showReceiverDialog()
        }

        // 4. Efirni to'xtatish
        btnStopStreaming.setOnClickListener {
            stopStreamingService()
        }

        // 5. Qabul qilishdan chiqish
        btnBackFromReceiver.setOnClickListener {
            stopReceiverMode()
        }

        startPassiveUdpDiscovery()
    }

    override fun onStart() {
        super.onStart()
        val filter = IntentFilter().apply {
            addAction(ScreenCaptureService.ACTION_STREAM_CONNECTED)
            addAction(ScreenCaptureService.ACTION_STREAM_FAILED)
            addAction(ScreenCaptureService.ACTION_STREAM_STOPPED)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(streamStatusReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(streamStatusReceiver, filter)
        }
    }

    override fun onStop() {
        super.onStop()
        try {
            unregisterReceiver(streamStatusReceiver)
        } catch (e: Exception) {}
    }

    private fun checkNetworkStatus() {
        val connMgr = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val activeNet = connMgr.activeNetwork
        val caps = connMgr.getNetworkCapabilities(activeNet)

        val isWifi = caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
        if (isWifi) {
            tvHeaderStatus.text = "● Wi-Fi: Ulangan"
            tvHeaderStatus.setTextColor(0xFF10B981.toInt())
        } else {
            val isCellular = caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true
            if (isCellular) {
                tvHeaderStatus.text = "⚠️ Mobil internet (Wi-Fi yo'q)"
                tvHeaderStatus.setTextColor(0xFFEF4444.toInt())
            } else {
                tvHeaderStatus.text = "● Tarmoq yo'q"
                tvHeaderStatus.setTextColor(0xFF6B7280.toInt())
            }
        }
    }

    private fun launchQrScanner() {
        val options = ScanOptions().apply {
            setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            setPrompt("Kompyuter ekranidagi QR-kodga qarating")
            setCameraId(0)
            setBeepEnabled(true)
            setBarcodeImageEnabled(false)
            setOrientationLocked(false)
        }
        barcodeLauncher.launch(options)
    }

    private fun parseQrData(content: String): Triple<String, Int, String> {
        try {
            if (content.startsWith("{")) {
                val json = JSONObject(content)
                val rawIp = json.optString("ip", "")
                val port = json.optInt("port", 4848)
                val pin = json.optString("pin", "777888")
                val (cleanHost, cleanPort) = ScreenCaptureService.parseHostAndPort(rawIp, port)
                if (cleanHost.isNotEmpty()) return Triple(cleanHost, cleanPort, pin)
            }
        } catch (e: Exception) {}

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
                val (cleanHost, cleanPort) = ScreenCaptureService.parseHostAndPort(host, port)
                return Triple(cleanHost, cleanPort, pin)
            }
        } catch (e: Exception) {}

        val (cleanHost, cleanPort) = ScreenCaptureService.parseHostAndPort(content)
        return Triple(cleanHost, cleanPort, "777888")
    }

    private fun requestScreenProjection() {
        projectionLauncher.launch(mediaProjectionManager.createScreenCaptureIntent())
    }

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

        tvStreamingLiveBadge.text = "🟡  ULANMOQDA..."
        tvStreamingLiveBadge.setTextColor(0xFF00E5FF.toInt())
        tvStreamingTarget.text = "Kompyuter: $targetServerIp:$targetServerPort"
        tvStreamingPin.text = "Xona PIN: $targetRoomPin"
    }

    private fun stopStreamingService() {
        val intent = Intent(this, ScreenCaptureService::class.java)
        stopService(intent)

        isStreaming = false
        layoutStreamingActive.visibility = View.GONE
        layoutReceiverActive.visibility = View.GONE
        layoutModeSelection.visibility = View.VISIBLE
        checkNetworkStatus()
    }

    private fun showConnectionErrorDialog(errorMsg: String) {
        AlertDialog.Builder(this)
            .setTitle("Kompyuterga ulanib bo'lmadi")
            .setMessage("Xatolik: $errorMsg\n\nIltimos, quyidagilarni tekshiring:\n1. Telefoningiz va Kompyuteringiz bir xil Wi-Fi tarmog'iga ulangan bo'lishi kerak (Mobil internetda ishlamaydi).\n2. Kompyuterda ScreenShare Pro dasturi ishlab turganiga ishonch hosil qiling.")
            .setPositiveButton("Tushundim", null)
            .show()
    }

    private fun showReceiverDialog() {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(60, 40, 60, 20)
        }

        val etIp = EditText(this).apply {
            hint = "Server IP (masalan: 10.121.221.21)"
            setText(targetServerIp)
        }

        val etPin = EditText(this).apply {
            hint = "PIN kod (masalan: 777888)"
            setText("777888")
        }

        container.addView(etIp)
        container.addView(etPin)

        AlertDialog.Builder(this)
            .setTitle("Ekranni Qabul Qilish")
            .setMessage("Uzatuvchi kompyuter IP va PIN kodini kiriting:")
            .setView(container)
            .setPositiveButton("Ko'rish") { _, _ ->
                val rawIp = etIp.text.toString().trim()
                val pin = etPin.text.toString().trim().ifEmpty { "777888" }
                if (rawIp.isNotEmpty()) {
                    val (cleanHost, cleanPort) = ScreenCaptureService.parseHostAndPort(rawIp)
                    startReceiverMode(cleanHost, cleanPort, pin)
                }
            }
            .setNegativeButton("Bekor qilish", null)
            .show()
    }

    private fun startReceiverMode(host: String, port: Int, pin: String) {
        layoutModeSelection.visibility = View.GONE
        layoutStreamingActive.visibility = View.GONE
        layoutReceiverActive.visibility = View.VISIBLE
        layoutReceiverWaiting.visibility = View.VISIBLE

        try {
            val opts = IO.Options().apply { reconnection = true }
            val socketUrl = "http://$host:$port"
            receiverSocket = IO.socket(socketUrl, opts)
            receiverSocket?.connect()

            receiverSocket?.on(Socket.EVENT_CONNECT) {
                val joinData = JSONObject().apply {
                    put("pin", pin)
                    put("roomId", pin)
                }
                receiverSocket?.emit("join-as-receiver", joinData)
                receiverSocket?.emit("join-room", joinData)
            }

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
            Toast.makeText(this, "Ulanish xatosi: ${e.message}", Toast.LENGTH_SHORT).show()
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
                        val (cleanHost, cleanPort) = ScreenCaptureService.parseHostAndPort(ip)
                        withContext(Dispatchers.Main) {
                            targetServerIp = cleanHost
                            targetServerPort = cleanPort
                            targetRoomPin = pin
                            etTargetIp.setText(cleanHost)
                            etTargetPin.setText(pin)
                            tvHeaderStatus.text = "● Kompyuter topildi"
                            tvHeaderStatus.setTextColor(0xFF10B981.toInt())
                        }
                    }
                }
            } catch (e: Exception) {
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
