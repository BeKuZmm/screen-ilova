package com.screenshare.pro

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.animation.Animation
import android.view.animation.ScaleAnimation
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress

class MainActivity : AppCompatActivity() {

    private lateinit var tvWifiStatus: TextView
    private lateinit var ringOuter: View
    private lateinit var ringMiddle: View
    private lateinit var tvDeviceName: TextView
    private lateinit var tvDeviceIp: TextView
    private lateinit var tvDeviceBadge: TextView
    private lateinit var ivDeviceIcon: ImageView
    private lateinit var btnToggleStream: Button
    private lateinit var btnQrScan: ImageButton
    private lateinit var cardDiscovered: View

    private lateinit var mediaProjectionManager: MediaProjectionManager
    private var isStreaming = false
    private var discoveredIp = ""
    private var is60Fps = true

    private var discoveryJob: Job? = null

    companion object {
        private const val REQUEST_MEDIA_PROJECTION = 1001
        private const val UDP_DISCOVERY_PORT = 4847
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        tvWifiStatus = findViewById(R.id.tvWifiStatus)
        ringOuter = findViewById(R.id.ringOuter)
        ringMiddle = findViewById(R.id.ringMiddle)
        tvDeviceName = findViewById(R.id.tvDeviceName)
        tvDeviceIp = findViewById(R.id.tvDeviceIp)
        tvDeviceBadge = findViewById(R.id.tvDeviceBadge)
        ivDeviceIcon = findViewById(R.id.ivDeviceIcon)
        btnToggleStream = findViewById(R.id.btnToggleStream)
        btnQrScan = findViewById(R.id.btnQrScan)
        cardDiscovered = findViewById(R.id.cardDiscovered)

        mediaProjectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager

        startRadarAnimation()
        startUdpDiscovery()

        btnToggleStream.setOnClickListener {
            if (!isStreaming) {
                if (discoveredIp.isEmpty()) {
                    showManualIpDialog()
                    return@setOnClickListener
                }
                startActivityForResult(mediaProjectionManager.createScreenCaptureIntent(), REQUEST_MEDIA_PROJECTION)
            } else {
                stopScreenShare()
            }
        }

        btnQrScan.setOnClickListener {
            showManualIpDialog()
        }

        cardDiscovered.setOnClickListener {
            showManualIpDialog()
        }
    }

    // RADAR TO'LQIN ANIMATSIYASI
    private fun startRadarAnimation() {
        val anim = ScaleAnimation(
            0.8f, 1.25f,
            0.8f, 1.25f,
            Animation.RELATIVE_TO_SELF, 0.5f,
            Animation.RELATIVE_TO_SELF, 0.5f
        ).apply {
            duration = 1800
            repeatCount = Animation.INFINITE
            repeatMode = Animation.REVERSE
        }
        ringOuter.startAnimation(anim)

        val animMid = ScaleAnimation(
            0.85f, 1.15f,
            0.85f, 1.15f,
            Animation.RELATIVE_TO_SELF, 0.5f,
            Animation.RELATIVE_TO_SELF, 0.5f
        ).apply {
            duration = 1400
            repeatCount = Animation.INFINITE
            repeatMode = Animation.REVERSE
        }
        ringMiddle.startAnimation(animMid)
    }

    // WI-FI ORQALI KOMPYUTERNI AVTOMATIK TOPISH (UDP BEACON)
    private fun startUdpDiscovery() {
        discoveryJob = CoroutineScope(Dispatchers.IO).launch {
            var socket: DatagramSocket? = null
            try {
                socket = DatagramSocket(null).apply {
                    reuseAddress = true
                    bind(InetSocketAddress(UDP_DISCOVERY_PORT))
                    soTimeout = 4000
                }
                val buffer = ByteArray(1024)
                val packet = DatagramPacket(buffer, buffer.size)

                while (isActive) {
                    try {
                        socket.receive(packet)
                        val message = String(packet.data, 0, packet.length)
                        val json = JSONObject(message)

                        if (json.optString("app") == "ScreenSharePro") {
                            val name = json.optString("name", "Kompyuter (PC)")
                            val ip = json.optString("ip", packet.address.hostAddress ?: "")

                            withContext(Dispatchers.Main) {
                                onDeviceDiscovered(name, ip)
                            }
                        }
                    } catch (e: Exception) {
                        // timeout bo'lsa davom etadi
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            } finally {
                socket?.close()
            }
        }
    }

    private fun onDeviceDiscovered(name: String, ip: String) {
        discoveredIp = ip
        tvDeviceName.text = name
        tvDeviceIp.text = "$ip (Wi-Fi orqali tayyor)"
        tvWifiStatus.text = "● Bog'landi: $name"
        tvDeviceBadge.text = "TAYYOR"
        tvDeviceBadge.setTextColor(getColor(R.color.accent_green))
        ivDeviceIcon.setImageResource(android.R.drawable.stat_sys_upload_done)
    }

    private fun showManualIpDialog() {
        val input = EditText(this).apply {
            hint = "Masalan: 192.168.1.100"
            setText(discoveredIp)
        }

        AlertDialog.Builder(this)
            .setTitle("Qurilma IP manzili")
            .setMessage("Kompyuteringiz ekranda ko'rsatgan IP manzilni kiriting:")
            .setView(input)
            .setPositiveButton("Saqlash") { _, _ ->
                val ip = input.text.toString().trim()
                if (ip.isNotEmpty()) {
                    onDeviceDiscovered("Kompyuter (Qo'lda kiritildi)", ip)
                }
            }
            .setNegativeButton("Bekor qilish", null)
            .show()
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_MEDIA_PROJECTION) {
            if (resultCode == Activity.RESULT_OK && data != null) {
                startScreenShare(resultCode, data)
            } else {
                Toast.makeText(this, "Ekranni yozib olish rad etildi", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun startScreenShare(resultCode: Int, data: Intent) {
        val serviceIntent = Intent(this, ScreenCaptureService::class.java).apply {
            putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, resultCode)
            putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, data)
            putExtra(ScreenCaptureService.EXTRA_SERVER_IP, discoveredIp)
            putExtra(ScreenCaptureService.EXTRA_ROOM_PIN, "777888")
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent)
        } else {
            startService(serviceIntent)
        }

        isStreaming = true
        btnToggleStream.text = "⛔ UZATISHNI TO'XTATISH"
        btnToggleStream.setBackgroundColor(getColor(R.color.danger))
    }

    private fun stopScreenShare() {
        val serviceIntent = Intent(this, ScreenCaptureService::class.java)
        stopService(serviceIntent)

        isStreaming = false
        btnToggleStream.text = "🚀 EKRANNI UZATISHNI BOSHLASH"
        btnToggleStream.setBackgroundResource(R.drawable.btn_gradient_cyan)
    }

    override fun onDestroy() {
        super.onDestroy()
        discoveryJob?.cancel()
    }
}
