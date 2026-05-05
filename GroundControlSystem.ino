#include <Arduino.h>
#include <SPI.h>
#include <RF24.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"

// ------------------------------
// Hardware pin assignment
// Nano ESP32 <-> nRF24L01+
// CE  -> D9
// CSN -> D10
// SCK -> D13
// MISO-> D12
// MOSI-> D11
// ------------------------------
constexpr uint8_t PIN_CE  = 9;
constexpr uint8_t PIN_CSN = 10;

RF24 radio(PIN_CE, PIN_CSN);

// ------------------------------
// Must match STM32 NRF24 config
// ------------------------------
const uint8_t RADIO_ADDRESS[5] = {'S', 'T', 'R', 'I', 'X'};
constexpr uint8_t RADIO_CHANNEL = 76;
constexpr rf24_datarate_e RADIO_DATA_RATE = RF24_1MBPS;
constexpr rf24_pa_dbm_e RADIO_PA_LEVEL = RF24_PA_LOW;
constexpr unsigned long SERIAL_BAUD = 115200;

constexpr uint8_t PACKET_SIZE = 32;
constexpr uint32_t HEARTBEAT_PERIOD_MS = 500;

// Serial 출력이 너무 많으면 사용자 입력 처리가 체감상 밀립니다.
// 명령 디버깅 중에는 IMU 출력은 끄는 것을 권장합니다.
constexpr bool PRINT_IMU_TELEMETRY = false;
constexpr bool PRINT_GNSS_TELEMETRY = false;
constexpr bool PRINT_STATUS_TELEMETRY = true;

// ------------------------------
// RTOS objects
// ------------------------------
QueueHandle_t g_commandQueue = nullptr;
SemaphoreHandle_t g_radioMutex = nullptr;
SemaphoreHandle_t g_serialMutex = nullptr;

// ------------------------------
// Packet type
// Must match NRF24_Packet.h
// ------------------------------
enum class PacketType : uint8_t
{
  None          = 0x00,
  Command       = 0x10,
  ImuTelemetry  = 0x20,
  GnssTelemetry = 0x21,
  SystemStatus  = 0x22
};

enum class CommandId : uint8_t
{
  None = 0x00,

  Heartbeat = 0x01,

  Arm    = 0x10,
  Disarm = 0x11,

  SetHover    = 0x12,
  SetAltHold  = 0x13,
  SetOffboard = 0x14,

  EmergencyHover  = 0x20,
  EmergencyLand   = 0x21,
  EmergencyDisarm = 0x22,

  // Bench motor PWM command.
  // param1 = PWM pulse width in microseconds.
  MotorTest = 0x30
};

enum class ArmState : uint8_t
{
  Disarmed = 0,
  Armed
};

enum class FlightMode : uint8_t
{
  Idle = 0,
  Hover,
  AltHold,
  Offboard,
  EmergencyHover,
  EmergencyLand,
  EmergencyDisarm
};

enum class EmergencyState : uint8_t
{
  None = 0,
  HoverRequested,
  LandRequested,
  DisarmRequested
};

constexpr uint8_t TargetSystemBroadcast = 0x00;
constexpr uint8_t TargetSystemFlightController = 0x01;

constexpr uint16_t StatusFlagImuValid      = 1U << 0U;
constexpr uint16_t StatusFlagBaroValid     = 1U << 1U;
constexpr uint16_t StatusFlagGnssValid     = 1U << 2U;
constexpr uint16_t StatusFlagRfLinkAlive   = 1U << 3U;
constexpr uint16_t StatusFlagCommandAccept = 1U << 4U;
constexpr uint16_t StatusFlagCommandReject = 1U << 5U;

#pragma pack(push, 1)

struct ImuTelemetryPacket
{
  uint8_t packetType;
  uint8_t sequence;
  uint16_t timeMs10;

  int16_t qw;
  int16_t qx;
  int16_t qy;
  int16_t qz;

  int16_t gxDps10;
  int16_t gyDps10;
  int16_t gzDps10;

  int16_t axMg;
  int16_t ayMg;
  int16_t azMg;

  int16_t relativeAltCm;

  uint8_t flags;
  uint8_t reserved0;
  uint16_t reserved1;

  uint16_t crc16;
};

struct GnssTelemetryPacket
{
  uint8_t packetType;
  uint8_t sequence;
  uint16_t timeMs10;

  uint8_t fixType;
  uint8_t flags;
  uint16_t reserved0;

  int32_t lat;
  int32_t lon;
  int32_t hmslMm;

  uint16_t hAccCm;
  uint16_t vAccCm;

  int16_t relativeAltCm;

  uint16_t reserved1;
  uint16_t reserved2;

  uint16_t crc16;
};

struct CommandPacket
{
  uint8_t packetType;
  uint8_t sequence;
  uint16_t timeMs10;

  uint8_t commandId;
  uint8_t targetSystem;
  uint16_t flags;

  int16_t param1;
  int16_t param2;
  int16_t param3;
  int16_t param4;

  uint8_t reserved[14];

  uint16_t crc16;
};

struct SystemStatusPacket
{
  uint8_t packetType;
  uint8_t sequence;
  uint16_t timeMs10;

  uint8_t armState;
  uint8_t flightMode;
  uint8_t emergencyState;
  uint8_t lastCommandId;

  uint8_t lastCommandSequence;
  uint8_t linkFlags;
  uint16_t statusFlags;

  uint16_t rfRxCount;
  uint16_t rfTxCount;
  uint16_t rfErrorCount;

  uint8_t reserved[12];

  uint16_t crc16;
};

#pragma pack(pop)

static_assert(sizeof(ImuTelemetryPacket) == PACKET_SIZE, "IMU packet must be 32 bytes");
static_assert(sizeof(GnssTelemetryPacket) == PACKET_SIZE, "GNSS packet must be 32 bytes");
static_assert(sizeof(CommandPacket) == PACKET_SIZE, "Command packet must be 32 bytes");
static_assert(sizeof(SystemStatusPacket) == PACKET_SIZE, "System status packet must be 32 bytes");

struct GcsCommand
{
  CommandId commandId;
  int16_t param1;
  int16_t param2;
  int16_t param3;
  int16_t param4;
  uint8_t repeatCount;
  uint16_t gapMs;
  bool logTx;
};

uint8_t g_commandSequence = 0;

void LockSerial()
{
  if (g_serialMutex != nullptr)
  {
    xSemaphoreTake(g_serialMutex, portMAX_DELAY);
  }
}

void UnlockSerial()
{
  if (g_serialMutex != nullptr)
  {
    xSemaphoreGive(g_serialMutex);
  }
}

uint16_t calculateCrc16(const uint8_t* data, size_t length)
{
  uint16_t crc = 0xFFFF;

  if (data == nullptr)
  {
    return 0;
  }

  for (size_t i = 0; i < length; ++i)
  {
    crc ^= static_cast<uint16_t>(data[i]) << 8;

    for (uint8_t bit = 0; bit < 8; ++bit)
    {
      if ((crc & 0x8000) != 0)
      {
        crc = static_cast<uint16_t>((crc << 1) ^ 0x1021);
      }
      else
      {
        crc = static_cast<uint16_t>(crc << 1);
      }
    }
  }

  return crc;
}

void storeCrc(uint8_t* packet)
{
  const uint16_t crc = calculateCrc16(packet, PACKET_SIZE - 2);

  packet[30] = static_cast<uint8_t>(crc & 0xFF);
  packet[31] = static_cast<uint8_t>((crc >> 8) & 0xFF);
}

bool validatePacketCrc(const uint8_t* packet)
{
  const uint16_t receivedCrc =
    static_cast<uint16_t>(packet[30]) |
    (static_cast<uint16_t>(packet[31]) << 8);

  const uint16_t calculatedCrc = calculateCrc16(packet, PACKET_SIZE - 2);

  return receivedCrc == calculatedCrc;
}

float unscaleQuaternion(int16_t value)
{
  return static_cast<float>(value) / 30000.0f;
}

float unscaleGyroDps(int16_t value)
{
  return static_cast<float>(value) / 10.0f;
}

float unscaleAccelG(int16_t value)
{
  return static_cast<float>(value) / 1000.0f;
}

float unscaleAltitudeM(int16_t value)
{
  return static_cast<float>(value) / 100.0f;
}

const char* commandIdToString(CommandId id)
{
  switch (id)
  {
    case CommandId::Heartbeat: return "Heartbeat";
    case CommandId::Arm: return "Arm";
    case CommandId::Disarm: return "Disarm";
    case CommandId::SetHover: return "SetHover";
    case CommandId::SetAltHold: return "SetAltHold";
    case CommandId::SetOffboard: return "SetOffboard";
    case CommandId::EmergencyHover: return "EmergencyHover";
    case CommandId::EmergencyLand: return "EmergencyLand";
    case CommandId::EmergencyDisarm: return "EmergencyDisarm";
    case CommandId::MotorTest: return "MotorTest";
    default: return "None";
  }
}

const char* armStateToString(uint8_t state)
{
  switch (static_cast<ArmState>(state))
  {
    case ArmState::Disarmed: return "Disarmed";
    case ArmState::Armed: return "Armed";
    default: return "Unknown";
  }
}

const char* flightModeToString(uint8_t mode)
{
  switch (static_cast<FlightMode>(mode))
  {
    case FlightMode::Idle: return "Idle";
    case FlightMode::Hover: return "Hover";
    case FlightMode::AltHold: return "AltHold";
    case FlightMode::Offboard: return "Offboard";
    case FlightMode::EmergencyHover: return "EmergencyHover";
    case FlightMode::EmergencyLand: return "EmergencyLand";
    case FlightMode::EmergencyDisarm: return "EmergencyDisarm";
    default: return "Unknown";
  }
}

void printHelp()
{
  LockSerial();
  Serial.println();
  Serial.println("========== GCS COMMANDS ==========");
  Serial.println("help      : show this help");
  Serial.println("hb        : send heartbeat once");
  Serial.println("arm       : arm drone, burst TX");
  Serial.println("disarm    : disarm drone, burst TX");
  Serial.println("hover     : set hover mode, burst TX");
  Serial.println("althold   : set altitude hold mode, burst TX");
  Serial.println("offboard  : set offboard mode, burst TX");
  Serial.println("ehover    : emergency hover, burst TX");
  Serial.println("eland     : emergency land, burst TX");
  Serial.println("edisarm   : emergency disarm, burst TX");
  Serial.println("1000~2000 : set all motor PWM in us, requires armed state");
  Serial.println("==================================");
  Serial.println();
  UnlockSerial();
}

// RF24 접근은 반드시 g_radioMutex를 잡은 task 안에서만 수행합니다.
// 이 함수는 mutex를 직접 잡지 않습니다.
bool sendCommandRaw(CommandId commandId,
                    int16_t param1,
                    int16_t param2,
                    int16_t param3,
                    int16_t param4,
                    uint8_t* outSequence)
{
  uint8_t packet[PACKET_SIZE] = {0};
  auto* commandPacket = reinterpret_cast<CommandPacket*>(packet);

  commandPacket->packetType = static_cast<uint8_t>(PacketType::Command);
  commandPacket->sequence = g_commandSequence++;
  commandPacket->timeMs10 = static_cast<uint16_t>(millis() / 10);

  commandPacket->commandId = static_cast<uint8_t>(commandId);
  commandPacket->targetSystem = TargetSystemFlightController;
  commandPacket->flags = 0;

  commandPacket->param1 = param1;
  commandPacket->param2 = param2;
  commandPacket->param3 = param3;
  commandPacket->param4 = param4;

  storeCrc(packet);

  radio.stopListening();
  delayMicroseconds(150);

  const bool ok = radio.write(packet, PACKET_SIZE);

  delayMicroseconds(150);
  radio.startListening();

  if (outSequence != nullptr)
  {
    *outSequence = commandPacket->sequence;
  }

  return ok;
}

bool enqueueCommand(CommandId commandId,
                    uint8_t repeatCount,
                    uint16_t gapMs,
                    bool logTx,
                    bool sendToFront,
                    int16_t param1 = 0,
                    int16_t param2 = 0,
                    int16_t param3 = 0,
                    int16_t param4 = 0)
{
  if (g_commandQueue == nullptr)
  {
    return false;
  }

  GcsCommand command = {};
  command.commandId = commandId;
  command.param1 = param1;
  command.param2 = param2;
  command.param3 = param3;
  command.param4 = param4;
  command.repeatCount = (repeatCount == 0U) ? 1U : repeatCount;
  command.gapMs = gapMs;
  command.logTx = logTx;

  BaseType_t result = pdFALSE;

  if (sendToFront)
  {
    result = xQueueSendToFront(g_commandQueue, &command, 0);
  }
  else
  {
    result = xQueueSendToBack(g_commandQueue, &command, 0);
  }

  if ((result != pdTRUE) && logTx)
  {
    LockSerial();
    Serial.print("[TX WARN] command queue full: ");
    Serial.println(commandIdToString(commandId));
    UnlockSerial();
  }

  return result == pdTRUE;
}

void printImuPacket(const uint8_t* payload)
{
  if (!PRINT_IMU_TELEMETRY)
  {
    return;
  }

  const auto* packet = reinterpret_cast<const ImuTelemetryPacket*>(payload);

  LockSerial();
  Serial.print("[IMU] seq=");
  Serial.print(packet->sequence);
  Serial.print(" t=");
  Serial.print(static_cast<uint32_t>(packet->timeMs10) * 10UL);

  Serial.print(" q=(");
  Serial.print(unscaleQuaternion(packet->qw), 4);
  Serial.print(", ");
  Serial.print(unscaleQuaternion(packet->qx), 4);
  Serial.print(", ");
  Serial.print(unscaleQuaternion(packet->qy), 4);
  Serial.print(", ");
  Serial.print(unscaleQuaternion(packet->qz), 4);
  Serial.print(")");

  Serial.print(" gyro[dps]=(");
  Serial.print(unscaleGyroDps(packet->gxDps10), 1);
  Serial.print(", ");
  Serial.print(unscaleGyroDps(packet->gyDps10), 1);
  Serial.print(", ");
  Serial.print(unscaleGyroDps(packet->gzDps10), 1);
  Serial.print(")");

  Serial.print(" acc[g]=(");
  Serial.print(unscaleAccelG(packet->axMg), 3);
  Serial.print(", ");
  Serial.print(unscaleAccelG(packet->ayMg), 3);
  Serial.print(", ");
  Serial.print(unscaleAccelG(packet->azMg), 3);
  Serial.print(")");

  Serial.print(" alt=");
  Serial.print(unscaleAltitudeM(packet->relativeAltCm), 2);
  Serial.println(" m");
  UnlockSerial();
}

void printGnssPacket(const uint8_t* payload)
{
  if (!PRINT_GNSS_TELEMETRY)
  {
    return;
  }

  const auto* packet = reinterpret_cast<const GnssTelemetryPacket*>(payload);

  LockSerial();
  Serial.print("[GNSS] seq=");
  Serial.print(packet->sequence);
  Serial.print(" t=");
  Serial.print(static_cast<uint32_t>(packet->timeMs10) * 10UL);

  Serial.print(" fix=");
  Serial.print(packet->fixType);

  Serial.print(" lat=");
  Serial.print(static_cast<double>(packet->lat) * 1e-7, 7);

  Serial.print(" lon=");
  Serial.print(static_cast<double>(packet->lon) * 1e-7, 7);

  Serial.print(" hmsl=");
  Serial.print(static_cast<float>(packet->hmslMm) / 1000.0f, 2);
  Serial.print(" m");

  Serial.print(" hAcc=");
  Serial.print(static_cast<uint32_t>(packet->hAccCm));
  Serial.print(" cm");

  Serial.print(" vAcc=");
  Serial.print(static_cast<uint32_t>(packet->vAccCm));
  Serial.print(" cm");

  Serial.print(" relAlt=");
  Serial.print(unscaleAltitudeM(packet->relativeAltCm), 2);
  Serial.println(" m");
  UnlockSerial();
}

void printSystemStatusPacket(const uint8_t* payload)
{
  if (!PRINT_STATUS_TELEMETRY)
  {
    return;
  }

  const auto* packet = reinterpret_cast<const SystemStatusPacket*>(payload);

  LockSerial();
  Serial.print("[STATUS] seq=");
  Serial.print(packet->sequence);
  Serial.print(" t=");
  Serial.print(static_cast<uint32_t>(packet->timeMs10) * 10UL);

  Serial.print(" arm=");
  Serial.print(armStateToString(packet->armState));

  Serial.print(" mode=");
  Serial.print(flightModeToString(packet->flightMode));

  Serial.print(" lastCmd=");
  Serial.print(commandIdToString(static_cast<CommandId>(packet->lastCommandId)));

  Serial.print(" lastSeq=");
  Serial.print(packet->lastCommandSequence);

  Serial.print(" flags=0x");
  Serial.print(packet->statusFlags, HEX);

  if ((packet->statusFlags & StatusFlagRfLinkAlive) != 0)
  {
    Serial.print(" RF_LINK");
  }

  if ((packet->statusFlags & StatusFlagCommandAccept) != 0)
  {
    Serial.print(" CMD_ACCEPT");
  }

  if ((packet->statusFlags & StatusFlagCommandReject) != 0)
  {
    Serial.print(" CMD_REJECT");
  }

  Serial.print(" rx=");
  Serial.print(packet->rfRxCount);

  Serial.print(" tx=");
  Serial.print(packet->rfTxCount);

  Serial.print(" err=");
  Serial.println(packet->rfErrorCount);
  UnlockSerial();
}

void handleRxPacket(const uint8_t* payload)
{
  if (!validatePacketCrc(payload))
  {
    LockSerial();
    Serial.println("[RX WARN] CRC mismatch");
    UnlockSerial();
    return;
  }

  const PacketType type = static_cast<PacketType>(payload[0]);

  switch (type)
  {
    case PacketType::ImuTelemetry:
      printImuPacket(payload);
      break;

    case PacketType::GnssTelemetry:
      printGnssPacket(payload);
      break;

    case PacketType::SystemStatus:
      printSystemStatusPacket(payload);
      break;

    default:
      LockSerial();
      Serial.print("[RX WARN] Unknown packet type: 0x");
      Serial.println(payload[0], HEX);
      UnlockSerial();
      break;
  }
}

bool isDecimalNumber(const String& input)
{
  if (input.length() == 0)
  {
    return false;
  }

  for (uint16_t i = 0; i < input.length(); ++i)
  {
    const char c = input.charAt(i);

    if ((c < '0') || (c > '9'))
    {
      return false;
    }
  }

  return true;
}

int clampMotorPwm(int pwm)
{
  if (pwm < 1000)
  {
    return 1000;
  }

  if (pwm > 2000)
  {
    return 2000;
  }

  return pwm;
}

void parseSerialLine(const char* line)
{
  if (line == nullptr)
  {
    return;
  }

  String input(line);
  input.trim();
  input.toLowerCase();

  if (input.length() == 0)
  {
    return;
  }

  bool queued = true;

  if (input == "help")
  {
    printHelp();
    return;
  }
  else if (isDecimalNumber(input))
  {
    const int pwm = clampMotorPwm(input.toInt());

    queued = enqueueCommand(CommandId::MotorTest,
                            15,
                            15,
                            true,
                            true,
                            static_cast<int16_t>(pwm));

    LockSerial();
    Serial.print("[CMD] MotorTest pwm=");
    Serial.println(pwm);
    UnlockSerial();
  }
  else if (input == "hb")
  {
    queued = enqueueCommand(CommandId::Heartbeat, 1, 0, true, false);
  }
  else if (input == "arm")
  {
    queued = enqueueCommand(CommandId::Arm, 20, 20, true, true);
  }
  else if (input == "disarm")
  {
    queued = enqueueCommand(CommandId::Disarm, 25, 15, true, true);
  }
  else if (input == "hover")
  {
    queued = enqueueCommand(CommandId::SetHover, 20, 20, true, true);
  }
  else if (input == "althold")
  {
    queued = enqueueCommand(CommandId::SetAltHold, 15, 20, true, true);
  }
  else if (input == "offboard")
  {
    queued = enqueueCommand(CommandId::SetOffboard, 15, 20, true, true);
  }
  else if (input == "ehover")
  {
    queued = enqueueCommand(CommandId::EmergencyHover, 25, 15, true, true);
  }
  else if (input == "eland")
  {
    queued = enqueueCommand(CommandId::EmergencyLand, 25, 15, true, true);
  }
  else if (input == "edisarm")
  {
    queued = enqueueCommand(CommandId::EmergencyDisarm, 40, 10, true, true);
  }
  else
  {
    LockSerial();
    Serial.print("[WARN] Unknown command: ");
    Serial.println(input);
    Serial.println("Type 'help' for command list.");
    UnlockSerial();
    return;
  }

  if (!queued)
  {
    LockSerial();
    Serial.print("[TX WARN] failed to queue command: ");
    Serial.println(input);
    UnlockSerial();
  }
}

bool initRadio()
{
  if (!radio.begin())
  {
    return false;
  }

  radio.setAutoAck(false);
  radio.disableDynamicPayloads();
  radio.setPayloadSize(PACKET_SIZE);

  radio.setChannel(RADIO_CHANNEL);
  radio.setDataRate(RADIO_DATA_RATE);
  radio.setPALevel(RADIO_PA_LEVEL);
  radio.setCRCLength(RF24_CRC_16);

  radio.openReadingPipe(0, RADIO_ADDRESS);
  radio.openWritingPipe(RADIO_ADDRESS);

  radio.startListening();

  return true;
}

void SerialTask(void* argument)
{
  (void)argument;

  char lineBuffer[80] = {0};
  size_t lineLength = 0;

  while (true)
  {
    while (Serial.available() > 0)
    {
      const char c = static_cast<char>(Serial.read());

      if (c == '\r')
      {
        continue;
      }

      if (c == '\n')
      {
        lineBuffer[lineLength] = '\0';
        parseSerialLine(lineBuffer);
        lineLength = 0;
        lineBuffer[0] = '\0';
        continue;
      }

      if (lineLength < (sizeof(lineBuffer) - 1U))
      {
        lineBuffer[lineLength++] = c;
      }
      else
      {
        lineLength = 0;
        lineBuffer[0] = '\0';

        LockSerial();
        Serial.println("[SERIAL WARN] input line too long, dropped");
        UnlockSerial();
      }
    }

    vTaskDelay(pdMS_TO_TICKS(5));
  }
}

void CommandTxTask(void* argument)
{
  (void)argument;

  GcsCommand command = {};

  while (true)
  {
    if (xQueueReceive(g_commandQueue, &command, portMAX_DELAY) == pdTRUE)
    {
      bool anyOk = false;
      uint8_t lastSequence = 0U;

      for (uint8_t i = 0U; i < command.repeatCount; ++i)
      {
        if (xSemaphoreTake(g_radioMutex, pdMS_TO_TICKS(50)) == pdTRUE)
        {
          const bool ok = sendCommandRaw(command.commandId,
                                         command.param1,
                                         command.param2,
                                         command.param3,
                                         command.param4,
                                         &lastSequence);

          anyOk = anyOk || ok;

          xSemaphoreGive(g_radioMutex);
        }
        else
        {
          if (command.logTx)
          {
            LockSerial();
            Serial.println("[RF WARN] TX mutex timeout");
            UnlockSerial();
          }
        }

        if ((command.gapMs > 0U) && ((i + 1U) < command.repeatCount))
        {
          vTaskDelay(pdMS_TO_TICKS(command.gapMs));
        }
      }

      if (command.logTx)
      {
        LockSerial();
        Serial.print("[TX CMD] ");
        Serial.print(commandIdToString(command.commandId));
        Serial.print(" repeat=");
        Serial.print(command.repeatCount);
        Serial.print(" lastSeq=");
        Serial.print(lastSequence);
        Serial.print(" result=");
        Serial.println(anyOk ? "ok" : "fail");
        UnlockSerial();
      }
    }
  }
}

void RadioRxTask(void* argument)
{
  (void)argument;

  constexpr uint8_t MAX_RX_PER_CYCLE = 8U;
  uint8_t payloads[MAX_RX_PER_CYCLE][PACKET_SIZE];

  while (true)
  {
    uint8_t rxCount = 0U;

    if (xSemaphoreTake(g_radioMutex, pdMS_TO_TICKS(5)) == pdTRUE)
    {
      while ((rxCount < MAX_RX_PER_CYCLE) && radio.available())
      {
        memset(payloads[rxCount], 0, PACKET_SIZE);
        radio.read(payloads[rxCount], PACKET_SIZE);
        rxCount++;
      }

      xSemaphoreGive(g_radioMutex);
    }

    for (uint8_t i = 0U; i < rxCount; ++i)
    {
      handleRxPacket(payloads[i]);
    }

    vTaskDelay(pdMS_TO_TICKS(3));
  }
}

void HeartbeatTask(void* argument)
{
  (void)argument;

  while (true)
  {
    // Heartbeat는 사용자 명령보다 낮은 우선순위로 queue 뒤에 넣고,
    // TX 로그도 찍지 않습니다.
    enqueueCommand(CommandId::Heartbeat, 1, 0, false, false);
    vTaskDelay(pdMS_TO_TICKS(HEARTBEAT_PERIOD_MS));
  }
}

void setup()
{
  Serial.begin(SERIAL_BAUD);
  Serial.setTimeout(10);
  delay(1500);

  Serial.println();
  Serial.println("STRIX-FC nRF24L01+ GCS RTOS");
  Serial.println("Role: telemetry RX + command TX");
  Serial.println("Payload: fixed 32 bytes");
  Serial.println("Auto ACK: OFF");
  Serial.println("Dynamic payload: OFF");

  if (!initRadio())
  {
    Serial.println("[FATAL] radio.begin() failed");

    while (true)
    {
      delay(1000);
    }
  }

  g_radioMutex = xSemaphoreCreateMutex();
  g_serialMutex = xSemaphoreCreateMutex();
  g_commandQueue = xQueueCreate(32, sizeof(GcsCommand));

  if ((g_radioMutex == nullptr) ||
      (g_serialMutex == nullptr) ||
      (g_commandQueue == nullptr))
  {
    Serial.println("[FATAL] RTOS object creation failed");

    while (true)
    {
      delay(1000);
    }
  }

  LockSerial();
  Serial.print("Address : ");
  for (uint8_t i = 0; i < sizeof(RADIO_ADDRESS); ++i)
  {
    Serial.print(static_cast<char>(RADIO_ADDRESS[i]));
  }
  Serial.println();

  Serial.print("Channel : ");
  Serial.println(RADIO_CHANNEL);

  Serial.print("DataRate: ");
  switch (RADIO_DATA_RATE)
  {
    case RF24_250KBPS:
      Serial.println("250 kbps");
      break;

    case RF24_1MBPS:
      Serial.println("1 Mbps");
      break;

    case RF24_2MBPS:
      Serial.println("2 Mbps");
      break;

    default:
      Serial.println("Unknown");
      break;
  }
  UnlockSerial();

  printHelp();

  xTaskCreate(SerialTask,
              "SerialTask",
              4096,
              nullptr,
              4,
              nullptr);

  xTaskCreate(CommandTxTask,
              "CommandTxTask",
              4096,
              nullptr,
              5,
              nullptr);

  xTaskCreate(RadioRxTask,
              "RadioRxTask",
              4096,
              nullptr,
              3,
              nullptr);

  xTaskCreate(HeartbeatTask,
              "HeartbeatTask",
              2048,
              nullptr,
              1,
              nullptr);

  LockSerial();
  Serial.println("Waiting for telemetry...");
  Serial.println("RTOS tasks started.");
  UnlockSerial();
}

void loop()
{
  vTaskDelay(pdMS_TO_TICKS(1000));
}
