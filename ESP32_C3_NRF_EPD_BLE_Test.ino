#include <Arduino.h>
#include <NimBLEDevice.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <time.h>
#include "esp_sleep.h"


// ============================================================
// WiFi
// ============================================================

const char* WIFI_SSID = "Summor";

const char* WIFI_PASSWORD = "9001125mo";


// ============================================================
// Nuxt 图片接口
// ============================================================

const char* IMAGE_URL = "http://192.168.100.1:4560/epd";


// ============================================================
// BOOT 按钮
// ESP32-C3 BOOT = GPIO9
// ============================================================

const int CUSTOM_BUTTON_PIN = 9;


// ============================================================
// EPD 蓝牙设备
// ============================================================

const char* TARGET_NAME = "NRF_EPD_7FE5";


// ============================================================
// BLE UUID
// ============================================================

NimBLEUUID SERVICE_UUID(
    "62750001-d828-918d-fb46-b6c11c675aec"
);

NimBLEUUID CHARACTERISTIC_UUID(
    "62750002-d828-918d-fb46-b6c11c675aec"
);


// ============================================================
// 屏幕参数
// ============================================================

const uint16_t WIDTH  = 800;
const uint16_t HEIGHT = 480;


// 每个颜色图层：
// 800 × 480 ÷ 8 = 48000

const uint32_t IMAGE_SIZE = WIDTH * HEIGHT / 8;


// 两个图层总共：

// 黑色 48000
// 红色 48000
// 总计 96000


// ============================================================
// BLE 参数
// ============================================================

// 卖家网页默认 MTU = 20
const uint16_t BLE_MTU = 240;


// 20 字节中：
// 1 字节 CMD
// 1 字节 FLAG
// 18 字节图片

const uint16_t PAYLOAD_SIZE = BLE_MTU - 2;


// ============================================================
// EPD 命令
// ============================================================

const uint8_t CMD_INIT = 0x01;

const uint8_t CMD_REFRESH = 0x05;

const uint8_t CMD_WRITE = 0x30;


// ============================================================
// BLE 对象
// ============================================================

NimBLEClient* client = nullptr;

NimBLERemoteService* service = nullptr;

NimBLERemoteCharacteristic* characteristic = nullptr;


// ============================================================
// 图片缓存
// ============================================================

uint8_t* blackImage = nullptr;

uint8_t* redImage = nullptr;


// ============================================================
// 时间 / 深度睡眠函数声明
// ============================================================

bool isTimeValid();
bool syncTime();
void sleepUntilNextDay();


// ============================================================
// 打印内存状态
// ============================================================

void printMemory(const char* title)
{
    Serial.println();

    Serial.print(title);
    Serial.println();

    Serial.print("当前可用内存：");
    Serial.println(
        ESP.getFreeHeap()
    );

    Serial.print("历史最低内存：");
    Serial.println(
        ESP.getMinFreeHeap()
    );
}


// ============================================================
// WiFi 关闭
// ============================================================

void disconnectWiFi()
{
    Serial.println();
    Serial.println("关闭 WiFi...");

    WiFi.disconnect(true);

    WiFi.mode(WIFI_OFF);

    delay(100);

    Serial.println("WiFi 已关闭");

    printMemory(
        "WiFi 关闭后的内存："
    );
}


// ============================================================
// 连接 WiFi
// ============================================================

bool connectWiFiOnce()
{
    Serial.println();
    Serial.println("==============================");
    Serial.println("连接 WiFi");
    Serial.println("==============================");

    WiFi.mode(WIFI_STA);

    WiFi.begin(
        WIFI_SSID,
        WIFI_PASSWORD
    );

    uint32_t start =
        millis();

    while (
        WiFi.status() != WL_CONNECTED
    ) {

        if (
            millis() - start >
            20000
        ) {

            Serial.println();
            Serial.println(
                "WiFi 连接超时"
            );

            return false;
        }

        delay(300);

        Serial.print(".");
    }

    Serial.println();

    Serial.println(
        "WiFi 已连接"
    );
    Serial.printf("WiFi RSSI: %d dBm\n", WiFi.RSSI());
    Serial.printf("WiFi IP: %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("WiFi 状态: %d\n", WiFi.status());

    // 首次上电时 RTC 时间通常还没有建立。
    // 只有时间无效时才进行 NTP 校时。
    // 从深度睡眠唤醒时不重新校时，这样 00:00:01
    // 唤醒后可以立即执行电子纸更新。
    if (!isTimeValid()) {

        syncTime();
    }

    Serial.print(
        "IP："
    );

    Serial.println(
        WiFi.localIP()
    );

    printMemory(
        "WiFi 连接后的内存："
    );

    return true;
}


// WiFi 连接失败时最多重试 3 次（总共最多 4 次尝试）
bool connectWiFi()
{
    const int MAX_ATTEMPTS = 4;
    for (int attempt = 1; attempt <= MAX_ATTEMPTS; ++attempt) {
        Serial.printf("WiFi 连接尝试 %d/%d\n", attempt, MAX_ATTEMPTS);
        if (connectWiFiOnce()) return true;
        disconnectWiFi();
        if (attempt < MAX_ATTEMPTS) {
            Serial.println("等待 2 秒后重试 WiFi...");
            delay(2000);
        }
    }
    Serial.println("WiFi 连接连续失败，已达到重试上限");
    return false;
}

// ============================================================
// 下载图片
//
// 服务器必须返回：
// 黑色 48000 字节
// 红色 48000 字节
//
// 总计：96000 字节
// ============================================================

bool downloadImageOnce()
{
    Serial.println();
    Serial.println("==============================");
    Serial.println("下载电子纸图片");
    Serial.println("==============================");

    printMemory(
        "HTTP 下载前内存："
    );

    HTTPClient http;

    // --------------------------------------------------------
    // 建立 HTTP 连接
    // --------------------------------------------------------

    if (!http.begin(IMAGE_URL)) {

        Serial.println(
            "HTTP begin 失败"
        );

        return false;
    }

    http.setConnectTimeout(10000);
    http.setTimeout(30000);

    Serial.print("请求：");
    Serial.println(IMAGE_URL);

    int httpCode = http.GET();

    if (httpCode != HTTP_CODE_OK) {

        Serial.print("HTTP 错误：");
        Serial.println(httpCode);

        Serial.print("错误原因：");
        Serial.println(
            http.errorToString(httpCode)
        );

        http.end();

        return false;
    }

    int contentLength =
        http.getSize();

    Serial.print("服务器数据长度：");
    Serial.print(contentLength);
    Serial.println(" bytes");

    if (
        contentLength !=
        (int)(IMAGE_SIZE * 2)
    ) {

        Serial.println(
            "错误：服务器返回的数据不是 96000 bytes"
        );

        http.end();

        return false;
    }

    NetworkClient* stream =
        http.getStreamPtr();

    if (stream == nullptr) {

        Serial.println(
            "获取 HTTP 数据流失败"
        );

        http.end();

        return false;
    }

    // 按当前 TCP 缓冲区实际可读的数据量读取，避免 readBytes()
    // 为凑满 1024 字节反复阻塞。连续 10 秒没有收到新数据才判定失败。
    auto readLayer = [&](uint8_t* buffer, const char* layerName) -> bool {
        const uint32_t layerSize = IMAGE_SIZE;
        uint32_t received = 0;
        uint32_t lastPrint = millis();
        uint32_t lastData = millis();

        while (received < layerSize) {
            int availableBytes = stream->available();

            if (availableBytes > 0) {
                size_t remain = layerSize - received;
                size_t toRead = (size_t)availableBytes;
                if (toRead > remain) toRead = remain;
                int n = stream->read(buffer + received, toRead);

                if (n > 0) {
                    received += (uint32_t)n;
                    lastData = millis();
                }
            } else {
                if (!stream->connected()) {
                    Serial.printf("%s图层连接已断开\n", layerName);
                    break;
                }
                if (millis() - lastData >= 10000) {
                    Serial.printf("%s图层连续 10 秒没有收到数据，读取超时\n", layerName);
                    break;
                }
                delay(1);
            }

            if (millis() - lastPrint >= 1000 || received == layerSize) {
                Serial.printf("%s已下载：%u/%u  %u%%\n",
                    layerName, (unsigned int)received,
                    (unsigned int)layerSize,
                    (unsigned int)((received * 100U) / layerSize));
                lastPrint = millis();
            }
        }

        if (received != layerSize) {
            Serial.printf("%s图层未完整下载：%u/%u bytes\n",
                layerName, (unsigned int)received, (unsigned int)layerSize);
            return false;
        }

        Serial.printf("%s图层下载完成\n", layerName);
        return true;
    };

    Serial.println();
    Serial.println("下载黑色图层...");
    if (!readLayer(blackImage, "黑色")) {
        http.end();
        return false;
    }

    Serial.println();
    Serial.println("下载红色图层...");
    if (!readLayer(redImage, "红色")) {
        http.end();
        return false;
    }

    http.end();

    printMemory(
        "图片下载完成后的内存："
    );

    return true;
}

// 图片下载失败时最多重试 3 次（总共最多 4 次尝试）
bool downloadImage()
{
    const int MAX_ATTEMPTS = 4;
    for (int attempt = 1; attempt <= MAX_ATTEMPTS; ++attempt) {
        Serial.printf("图片下载尝试 %d/%d\n", attempt, MAX_ATTEMPTS);
        if (downloadImageOnce()) return true;
        if (attempt < MAX_ATTEMPTS) {
            Serial.println("等待 2 秒后重新下载图片...");
            delay(2000);
        }
    }
    Serial.println("图片下载连续失败，已达到重试上限");
    return false;
}

// ============================================================
// 发送 EPD 命令
// ============================================================

bool sendCommand(
    uint8_t command,
    const uint8_t* data = nullptr,
    size_t dataLength = 0
)
{
    if (
        characteristic ==
        nullptr
    ) {

        Serial.println(
            "BLE Characteristic 为空"
        );

        return false;
    }


    uint8_t buffer[20];


    if (
        dataLength >
        sizeof(buffer) - 1
    ) {

        Serial.println(
            "命令数据太长"
        );

        return false;
    }


    buffer[0] =
        command;


    if (
        data != nullptr &&
        dataLength > 0
    ) {

        memcpy(
            buffer + 1,
            data,
            dataLength
        );
    }


    size_t totalLength =
        1 + dataLength;


    Serial.print(
        "发送命令：0x"
    );

    if (
        command < 0x10
    ) {
        Serial.print("0");
    }

    Serial.println(
        command,
        HEX
    );


    bool result =
        characteristic->writeValue(
            buffer,
            totalLength,
            true
        );


    if (!result) {

        Serial.println(
            "命令发送失败"
        );

        return false;
    }


    return true;
}


// ============================================================
// 连接电子纸
// ============================================================

bool connectEPDOnce()
{
    Serial.println();
    Serial.println("==============================");
    Serial.println("扫描电子纸");
    Serial.println("==============================");


    printMemory(
        "BLE 扫描前内存："
    );


    NimBLEScan* scan =
        NimBLEDevice::getScan();


    scan->setActiveScan(
        true
    );

    scan->setInterval(
        100
    );

    scan->setWindow(
        80
    );


    NimBLEScanResults results =
        scan->getResults(
            5000
        );


    Serial.println(
        "扫描完成"
    );


    int found =
        -1;


    for (
        int i = 0;
        i < results.getCount();
        i++
    ) {

        const NimBLEAdvertisedDevice*
            device =
                results.getDevice(i);


        Serial.print(
            "["
        );

        Serial.print(
            i
        );

        Serial.print(
            "] "
        );


        if (
            device->haveName()
        ) {

            Serial.print(
                device->getName().c_str()
            );
        }
        else {

            Serial.print(
                "(no name)"
            );
        }


        Serial.print(
            "  "
        );


        Serial.println(
            device->getAddress()
                .toString()
                .c_str()
        );


        if (
            device->haveName()
        ) {

            String name =
                device->getName().c_str();


            if (
                name ==
                TARGET_NAME
            ) {

                found =
                    i;

                break;
            }
        }
    }


    if (
        found < 0
    ) {

        Serial.println();
        Serial.println(
            "没有找到 NRF_EPD_7FE5"
        );

        scan->clearResults();

        return false;
    }


    const NimBLEAdvertisedDevice*
        device =
            results.getDevice(
                found
            );


    Serial.println();
    Serial.println(
        "找到电子纸"
    );


    Serial.print(
        "地址："
    );

    Serial.println(
        device->getAddress()
            .toString()
            .c_str()
    );


    // ========================================================
    // 创建 BLE Client
    // ========================================================

    client =
        NimBLEDevice::createClient();


    if (
        client == nullptr
    ) {

        Serial.println(
            "创建 BLE Client 失败"
        );

        scan->clearResults();

        return false;
    }


    Serial.println(
        "正在连接..."
    );


    if (
        !client->connect(
            device->getAddress()
        )
    ) {

        Serial.println(
            "BLE 连接失败"
        );

        scan->clearResults();

        return false;
    }


    Serial.println(
        "BLE 连接成功"
    );


    delay(300);


    // ========================================================
    // 获取 Service
    // ========================================================

    service =
        client->getService(
            SERVICE_UUID
        );


    if (
        service == nullptr
    ) {

        Serial.println(
            "找不到 EPD Service"
        );

        client->disconnect();

        scan->clearResults();

        return false;
    }


    Serial.println(
        "Service 获取成功"
    );


    // ========================================================
    // 获取 Characteristic
    // ========================================================

    characteristic =
        service->getCharacteristic(
            CHARACTERISTIC_UUID
        );


    if (
        characteristic == nullptr
    ) {

        Serial.println(
            "找不到 EPD Characteristic"
        );

        client->disconnect();

        scan->clearResults();

        return false;
    }


    Serial.println(
        "Characteristic 获取成功"
    );

    Serial.println(
        "MTU：20"
    );


    scan->clearResults();


    printMemory(
        "BLE 连接后的内存："
    );


    return true;
}


// BLE 扫描/连接失败时最多重试 3 次（总共最多 4 次尝试）
bool connectEPD()
{
    const int MAX_ATTEMPTS = 4;
    for (int attempt = 1; attempt <= MAX_ATTEMPTS; ++attempt) {
        Serial.printf("BLE 连接尝试 %d/%d\n", attempt, MAX_ATTEMPTS);
        if (connectEPDOnce()) return true;

        // 清理本次失败留下的连接状态，再重新扫描连接
        NimBLEClient* failedClient = client;
        disconnectEPD();
        if (failedClient != nullptr) {
            NimBLEDevice::deleteClient(failedClient);
        }
        client = nullptr;
        service = nullptr;
        characteristic = nullptr;

        if (attempt < MAX_ATTEMPTS) {
            Serial.println("等待 2 秒后重新扫描并连接电子纸...");
            delay(2000);
        }
    }
    Serial.println("BLE 连接连续失败，已达到重试上限");
    return false;
}

// ============================================================
// 发送一个颜色图层
//
// 黑色第一包：30 0F + 18 字节
// 黑色后续：  30 F0 + 18 字节
//
// 红色第一包：30 00 + 18 字节
// 红色后续：  30 F0 + 18 字节
//
// 修改版：
//
// 1. 每一个 BLE 包都使用 Write With Response
// 2. 单个包失败自动重试
// 3. 最多重试 5 次
// 4. 失败时打印详细 BLE 状态
// ============================================================
bool sendImageBlock(const uint8_t * image, uint8_t firstFlag, const char * name) {
    if (characteristic == nullptr) {
        Serial.println("BLE Characteristic 为空");
        return false;
    }
    if (client == nullptr) {
        Serial.println("BLE Client 为空");
        return false;
    }
    Serial.println();
    Serial.println("==============================");
    Serial.print("发送");
    Serial.print(name);
    Serial.println("图层");
    Serial.println("==============================");
    uint8_t packet[BLE_MTU];
    uint32_t totalPackets = (IMAGE_SIZE + PAYLOAD_SIZE - 1) / PAYLOAD_SIZE;
    // ========================================================
    // 单个包最多尝试 5 次
    // ========================================================
    const int MAX_RETRY = 5;
    // ========================================================
    // 开始发送
    // ========================================================
    for (uint32_t i = 0; i < totalPackets; i++) {
        uint32_t offset = i * PAYLOAD_SIZE;
        uint32_t remaining = IMAGE_SIZE - offset;
        uint16_t chunkSize = remaining > PAYLOAD_SIZE ? PAYLOAD_SIZE : remaining;
        // ====================================================
        // 包头
        // ====================================================
        packet[0] = CMD_WRITE;
        if (i == 0) {
            packet[1] = firstFlag;
        } else {
            packet[1] = 0xF0;
        }
        // ====================================================
        // 图片数据
        // ====================================================
        memcpy(packet + 2, image + offset, chunkSize);
        // ====================================================
        // 当前包重试
        // ====================================================
        bool success = false;
        for (int retry = 0; retry < MAX_RETRY; retry++) {
            // ------------------------------------------------
            // 检查 BLE 连接
            // ------------------------------------------------
            bool connected = client->isConnected();
            if (!connected) {
                Serial.println();
                Serial.print(name);
                Serial.print(" 包号 ");
                Serial.print(i);
                Serial.println("：BLE 已断开");
                break;
            }
            // ------------------------------------------------
            // 第一次失败前不等待
            //
            // 后面逐渐增加等待时间：
            //
            // retry 0：0ms
            // retry 1：50ms
            // retry 2：100ms
            // retry 3：200ms
            // retry 4：500ms
            // ------------------------------------------------
            if (retry == 1) {
                delay(50);
            } else if (retry == 2) {
                delay(100);
            } else if (retry == 3) {
                delay(200);
            } else if (retry == 4) {
                delay(500);
            }
            // ------------------------------------------------
            // 使用 Write With Response
            //
            // 不再使用：
            //
            // i % 10 == 0
            //
            // 而是每个包都等待 EPD 响应。
            // ------------------------------------------------
            bool result = characteristic->writeValue(packet, chunkSize + 2, true);
            if (result) {
                success = true;
                break;
            }
            // ------------------------------------------------
            // 当前包发送失败
            // ------------------------------------------------
            Serial.println();
            Serial.print("BLE 写入失败：");
            Serial.print(name);
            Serial.print(" 包号=");
            Serial.print(i);
            Serial.print("/");
            Serial.print(totalPackets);
            Serial.print(" retry=");
            Serial.print(retry + 1);
            Serial.print("/");
            Serial.print(MAX_RETRY);
            Serial.print(" connected=");
            Serial.println(client->isConnected() ? "YES" : "NO");
            printMemory("BLE 写入失败时内存：");
        }
        // ====================================================
        // 5 次全部失败
        // ====================================================
        if (!success) {
            Serial.println();
            Serial.println("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
            Serial.print(name);
            Serial.print("发送失败，包号：");
            Serial.println(i);
            Serial.print("offset：");
            Serial.println(offset);
            Serial.print("chunkSize：");
            Serial.println(chunkSize);
            Serial.print("BLE 连接状态：");
            Serial.println(client->isConnected() ? "已连接" : "已断开");
            printMemory("最终发送失败内存：");
            Serial.println("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
            return false;
        }
        // ====================================================
        // 显示进度
        // ====================================================
        if (i == 0 || i == totalPackets - 1 || i % 100 == 0) {
            int percent = (
                (uint64_t)(i + 1) * 100) / totalPackets;
            Serial.print(name);
            Serial.print("：");
            Serial.print(i + 1);
            Serial.print("/");
            Serial.print(totalPackets);
            Serial.print("  ");
            Serial.print(percent);
            Serial.println("%");
        }
        // ====================================================
        // 每包之间稍微停一下
        //
        // 即使 Write With Response，
        // 电子纸 BLE 固件处理速度可能仍然有限。
        // ====================================================
        delay(5);
    }
    Serial.println();
    Serial.print(name);
    Serial.println("图层发送完成");
    return true;
}

// ============================================================
// 刷新电子纸
//
// 卖家网页协议：
// 05 A5
// ============================================================

bool refreshEPD()
{
    uint8_t data = 0xA5;


    Serial.println();
    Serial.println(
        "发送 REFRESH 05 A5"
    );


    return sendCommand(
        CMD_REFRESH,
        &data,
        1
    );
}


// ============================================================
// 断开 BLE
// ============================================================

void disconnectEPD()
{
    if (
        client != nullptr
    ) {

        if (
            client->isConnected()
        ) {

            Serial.println(
                "断开电子纸 BLE"
            );

            client->disconnect();
        }


        delay(100);


        client =
            nullptr;

        service =
            nullptr;

        characteristic =
            nullptr;
    }
}


// ============================================================
// 完整更新流程
//
// BOOT
// ↓
// WiFi
// ↓
// 下载 96000
// ↓
// WiFi OFF
// ↓
// BLE
// ↓
// INIT
// ↓
// 黑色
// ↓
// 红色
// ↓
// REFRESH
// ============================================================

void updateEPD()
{
    Serial.println();
    Serial.println();
    Serial.println(
        "================================"
    );
    Serial.println(
        "开始更新电子纸"
    );
    Serial.println(
        "================================"
    );


    printMemory(
        "更新开始内存："
    );


    // ========================================================
    // 1. WiFi
    // ========================================================

    if (
        !connectWiFi()
    ) {

        disconnectWiFi();

        return;
    }


    // ========================================================
    // 2. 下载图片
    // ========================================================

    bool downloadOK =
        downloadImage();


    // HTTP 完成后立刻关闭
    // WiFi
    disconnectWiFi();


    if (
        !downloadOK
    ) {

        Serial.println(
            "图片下载失败"
        );

        return;
    }


    // ========================================================
    // 3. 初始化 BLE
    //
    // 注意：
    // WiFi 下载期间没有保持 BLE 连接
    // ========================================================

    Serial.println();
    Serial.println(
        "初始化 BLE..."
    );

    // WiFi 下载完成后才初始化 BLE。
    // 这样下载图片时不会同时占用 NimBLE 内存。
    NimBLEDevice::init(
        "ESP32-C3"
    );

    Serial.println(
        "BLE 初始化完成"
    );

    printMemory(
        "BLE 初始化后的内存："
    );

    Serial.println();
    Serial.println(
        "开始连接电子纸 BLE..."
    );


    if (
        !connectEPD()
    ) {

        Serial.println(
            "电子纸连接失败"
        );

        NimBLEDevice::deinit(true);

        Serial.println(
            "BLE 已释放"
        );

        return;
    }


    // ========================================================
    // 4. INIT
    // ========================================================

    Serial.println();
    Serial.println(
        "发送 INIT"
    );


    if (
        !sendCommand(
            CMD_INIT
        )
    ) {

        Serial.println(
            "INIT 失败"
        );

        disconnectEPD();

        NimBLEDevice::deinit(true);

        Serial.println(
            "BLE 已释放"
        );

        return;
    }


    delay(200);


    // ========================================================
    // 5. 黑色
    // ========================================================

    if (
        !sendImageBlock(
            blackImage,
            0x0F,
            "黑色"
        )
    ) {

        Serial.println(
            "黑色图层发送失败"
        );

        disconnectEPD();

        NimBLEDevice::deinit(true);

        Serial.println(
            "BLE 已释放"
        );

        return;
    }


    // ========================================================
    // 6. 红色
    // ========================================================

    if (
        !sendImageBlock(
            redImage,
            0x00,
            "红色"
        )
    ) {

        Serial.println(
            "红色图层发送失败"
        );

        disconnectEPD();

        NimBLEDevice::deinit(true);

        Serial.println(
            "BLE 已释放"
        );

        return;
    }


    // ========================================================
    // 7. REFRESH
    // ========================================================

    if (
        !refreshEPD()
    ) {

        Serial.println(
            "REFRESH 失败"
        );

        disconnectEPD();

        NimBLEDevice::deinit(true);

        Serial.println(
            "BLE 已释放"
        );

        return;
    }


    Serial.println();
    Serial.println(
        "================================"
    );

    Serial.println(
        "电子纸更新完成"
    );

    Serial.println(
        "================================"
    );


    printMemory(
        "更新完成内存："
    );


    // ========================================================
    // 8. 断开 BLE
    // ========================================================

    disconnectEPD();

    // 释放 NimBLE 占用的内存。
    // 下一次按 BOOT 时，会在 WiFi 下载完成后重新初始化 BLE。
    NimBLEDevice::deinit(true);

    Serial.println();
    Serial.println(
        "BLE 已释放"
    );

    printMemory(
        "BLE 释放后的内存："
    );

    Serial.println();
    Serial.println(
        "等待下一次 BOOT..."
    );
}



// ============================================================
// 时间 / 深度睡眠
// ============================================================
//
// 中国大陆 UTC+8：UTC-8
// 如果需要日本时间，改成：UTC-9
//
const char* TIME_ZONE = "UTC-8";

// 只在首次上电、RTC 时间无效时进行 NTP 校时。
// 正常每天从深度睡眠唤醒后，RTC 会继续保持时间，
// 不需要再次联网校时，因此可以在 00:00:01 立即执行更新。
//
bool isTimeValid()
{
    time_t now = time(nullptr);

    // 2024 年以前认为时间无效
    return now >= 1704067200;
}

bool syncTime()
{
    Serial.println();
    Serial.println("==============================");
    Serial.println("NTP 校时");
    Serial.println("==============================");

    configTzTime(
        TIME_ZONE,
        "ntp.aliyun.com",
        "pool.ntp.org",
        "time.nist.gov"
    );

    struct tm timeInfo;

    if (!getLocalTime(&timeInfo, 15000)) {

        Serial.println(
            "NTP 校时失败"
        );

        return false;
    }

    Serial.println(
        "NTP 校时成功"
    );

    Serial.printf(
        "当前时间：%04d-%02d-%02d %02d:%02d:%02d\n",
        timeInfo.tm_year + 1900,
        timeInfo.tm_mon + 1,
        timeInfo.tm_mday,
        timeInfo.tm_hour,
        timeInfo.tm_min,
        timeInfo.tm_sec
    );

    return true;
}

// ============================================================
// 每天 00:00:01 深度睡眠唤醒
// ============================================================

void sleepUntilNextDay()
{
    time_t now = time(nullptr);

    // 如果时间无效，无法准确计算午夜。
    // 这种异常情况使用 24 小时 RTC 定时作为兜底。
    if (!isTimeValid()) {

        Serial.println();
        Serial.println(
            "当前时间无效，无法计算 00:00:01"
        );

        Serial.println(
            "使用 24 小时深度睡眠作为兜底"
        );

        esp_sleep_enable_timer_wakeup(
            24ULL * 60ULL * 60ULL * 1000000ULL
        );

        Serial.println(
            "进入深度睡眠..."
        );

        Serial.flush();

        esp_deep_sleep_start();

        return;
    }

    struct tm nowInfo;

    localtime_r(
        &now,
        &nowInfo
    );

    // 构造今天的 00:00:01
    struct tm nextInfo =
        nowInfo;

    nextInfo.tm_hour = 0;
    nextInfo.tm_min  = 0;
    nextInfo.tm_sec  = 1;

    time_t nextWake =
        mktime(&nextInfo);

    // 如果今天的 00:00:01 已经过去，
    // 就睡到明天 00:00:01。
    if (nextWake <= now) {

        nextInfo.tm_mday++;

        nextWake =
            mktime(&nextInfo);
    }

    uint64_t sleepSeconds =
        (uint64_t)(nextWake - now);

    if (sleepSeconds < 1) {
        sleepSeconds = 1;
    }

    Serial.println();
    Serial.println("==============================");

    Serial.printf(
        "当前时间：%04d-%02d-%02d %02d:%02d:%02d\n",
        nowInfo.tm_year + 1900,
        nowInfo.tm_mon + 1,
        nowInfo.tm_mday,
        nowInfo.tm_hour,
        nowInfo.tm_min,
        nowInfo.tm_sec
    );

    Serial.printf(
        "下次唤醒：%04d-%02d-%02d %02d:%02d:%02d\n",
        nextInfo.tm_year + 1900,
        nextInfo.tm_mon + 1,
        nextInfo.tm_mday,
        nextInfo.tm_hour,
        nextInfo.tm_min,
        nextInfo.tm_sec
    );

    Serial.printf(
        "深度睡眠：%llu 秒\n",
        (unsigned long long)sleepSeconds
    );

    Serial.println(
        "=============================="
    );

    esp_sleep_enable_timer_wakeup(
        sleepSeconds * 1000000ULL
    );

    Serial.println(
        "进入深度睡眠..."
    );

    Serial.flush();

    esp_deep_sleep_start();
}

// ============================================================
// setup
// ============================================================

void setup()
{
    Serial.begin(
        115200
    );

    delay(1500);

    Serial.println();
    Serial.println();
    Serial.println(
        "================================"
    );

    Serial.println(
        " ESP32-C3 EPD 日历"
    );

    Serial.println(
        " 自动每日更新版"
    );

    Serial.println(
        "================================"
    );

    // ========================================================
    // 查看唤醒原因
    // ========================================================

    esp_sleep_wakeup_cause_t wakeupReason =
        esp_sleep_get_wakeup_cause();

    if (
        wakeupReason ==
        ESP_SLEEP_WAKEUP_TIMER
    ) {

        Serial.println(
            "本次启动：每日定时唤醒"
        );
    }
    else {

        Serial.println(
            "本次启动：通电启动"
        );
    }

    // ========================================================
    // 图片内存
    // ========================================================

    Serial.println();
    Serial.println(
        "分配图片内存..."
    );

    Serial.print(
        "黑色："
    );

    Serial.print(
        IMAGE_SIZE
    );

    Serial.println(
        " bytes"
    );

    Serial.print(
        "红色："
    );

    Serial.print(
        IMAGE_SIZE
    );

    Serial.println(
        " bytes"
    );

    blackImage =
        (uint8_t*)malloc(
            IMAGE_SIZE
        );

    redImage =
        (uint8_t*)malloc(
            IMAGE_SIZE
        );

    if (
        blackImage == nullptr ||
        redImage == nullptr
    ) {

        Serial.println();
        Serial.println(
            "图片内存分配失败！"
        );

        printMemory(
            "当前内存："
        );

        // 内存异常时也不要一直运行。
        delay(1000);

        esp_sleep_enable_timer_wakeup(
            60ULL * 60ULL * 1000000ULL
        );

        Serial.println(
            "内存异常，1 小时后重试"
        );

        Serial.flush();

        esp_deep_sleep_start();

        return;
    }

    Serial.println(
        "图片内存分配成功"
    );

    printMemory(
        "初始化完成内存："
    );

    // ========================================================
    // 不再等待 BOOT 按钮
    //
    // 每次上电 / 定时唤醒，都直接执行一次原来的
    // BOOT 按下后的 updateEPD()。
    // ========================================================

    Serial.println();
    Serial.println(
        "开始执行 BOOT 按下后的效果..."
    );

    updateEPD();

    // ========================================================
    // 更新完成后：
    //
    // 计算下一个 00:00:01
    // 然后 ESP32-C3 进入深度睡眠。
    // ========================================================

    sleepUntilNextDay();
}


// ============================================================
// loop
// ============================================================

void loop()
{
    // 正常情况下永远不会执行到这里。
    //
    // setup() 完成更新后会直接进入深度睡眠，
    // 每天 00:00:01 由 RTC 定时器唤醒，
    // 唤醒后 ESP32 会重新执行 setup()。

    delay(1000);
}

