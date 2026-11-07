package com.screenshare.pro

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var etServerIp: EditText
    private lateinit var etRoomPin: EditText
    private lateinit var btnToggleStream: Button
    private lateinit var tvStatus: TextView

    private lateinit var mediaProjectionManager: MediaProjectionManager
    private var isStreaming = false

    companion object {
        private const val REQUEST_MEDIA_PROJECTION = 1001
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        etServerIp = findViewById(R.id.etServerIp)
        etRoomPin = findViewById(R.id.etRoomPin)
        btnToggleStream = findViewById(R.id.btnToggleStream)
        tvStatus = findViewById(R.id.tvStatus)

        mediaProjectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager

        btnToggleStream.setOnClickListener {
            if (!isStreaming) {
                val ip = etServerIp.text.toString().trim()
                val pin = etRoomPin.text.toString().trim()
                if (ip.isEmpty() || pin.isEmpty()) {
                    Toast.makeText(this, "IP manzil va PIN kodni kiriting", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                startActivityForResult(mediaProjectionManager.createScreenCaptureIntent(), REQUEST_MEDIA_PROJECTION)
            } else {
                stopScreenShare()
            }
        }
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
            putExtra(ScreenCaptureService.EXTRA_SERVER_IP, etServerIp.text.toString().trim())
            putExtra(ScreenCaptureService.EXTRA_ROOM_PIN, etRoomPin.text.toString().trim())
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent)
        } else {
            startService(serviceIntent)
        }

        isStreaming = true
        btnToggleStream.text = getString(R.string.stop_stream)
        tvStatus.text = "Holat: Efir uzatilmoqda..."
    }

    private fun stopScreenShare() {
        val serviceIntent = Intent(this, ScreenCaptureService::class.java)
        stopService(serviceIntent)

        isStreaming = false
        btnToggleStream.text = getString(R.string.start_stream)
        tvStatus.text = "Holat: To'xtatildi"
    }
}
