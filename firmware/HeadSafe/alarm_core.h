#pragma once
#include <cstdint>
#include <cstddef>
#include <cstring>

namespace headsafe
{
  struct AccelerationSample
  {
    int16_t ax = 0, ay = 0, az = 0;
  };
  inline int16_t signedWord(const uint8_t *p)
  {
    const uint16_t word = (uint16_t(p[0]) << 8) | p[1];
    return int16_t(word <= 32767 ? int32_t(word) : int32_t(word) - 65536);
  }
  inline bool parseAcceleration(const uint8_t *raw, size_t count, AccelerationSample &out)
  {
    if (!raw || count != 6)
      return false;
    out.ax = signedWord(raw);
    out.ay = signedWord(raw + 2);
    out.az = signedWord(raw + 4);
    return true;
  }
  enum class Source
  {
    Sensor,
    Physical,
    Remote
  };
  struct Event
  {
    uint32_t id = 0, uptimeMs = 0;
    int32_t value = 0;
    bool impact = false;
    Source source = Source::Sensor;
  };
  enum class CommandResult
  {
    New,
    Duplicate,
    Invalid,
    Full
  };
  struct ResetCommands
  {
    char ids[128][65] = {};
    size_t count = 0;
    CommandResult accept(const char *id)
    {
      const size_t length = std::strlen(id);
      if (length == 0 || length > 64)
        return CommandResult::Invalid;
      for (size_t i = 0; i < length; ++i)
      {
        const char c = id[i];
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == ':'))
          return CommandResult::Invalid;
      }
      for (size_t i = 0; i < count; ++i)
        if (std::strcmp(ids[i], id) == 0)
          return CommandResult::Duplicate;
      if (count == 128)
        return CommandResult::Full;
      std::strcpy(ids[count++], id);
      return CommandResult::New;
    }
  };
  inline bool hostMatchesIP(const char *host, const char *ip)
  {
    if (!ip[0] || std::strcmp(ip, "0.0.0.0") == 0)
      return false;
    const size_t length = std::strlen(ip);
    return std::strncmp(host, ip, length) == 0 && (host[length] == 0 || std::strcmp(host + length, ":80") == 0);
  }
  inline bool allowedHost(const char *host, const char *apIP, const char *staIP)
  {
    return hostMatchesIP(host, apIP) || hostMatchesIP(host, staIP);
  }
  inline bool sameOrigin(const char *origin, const char *host)
  {
    if (!origin[0])
      return true;
    if (std::strncmp(origin, "http://", 7) != 0)
      return false;
    return std::strcmp(origin + 7, host) == 0;
  }
  inline void skipWhitespace(const char *&p)
  {
    while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n')
      ++p;
  }
  inline bool parseCommand(const char *p, char (&out)[65])
  {
    skipWhitespace(p);
    if (*p++ != '{')
      return false;
    skipWhitespace(p);
    if (std::strncmp(p, "\"commandId\"", 11) != 0)
      return false;
    p += 11;
    skipWhitespace(p);
    if (*p++ != ':')
      return false;
    skipWhitespace(p);
    if (*p++ != '\"')
      return false;
    size_t n = 0;
    while (*p && *p != '\"')
    {
      const char c = *p++;
      if (n == 64 || !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == ':'))
        return false;
      out[n++] = c;
    }
    if (n == 0 || *p++ != '\"')
      return false;
    out[n] = 0;
    skipWhitespace(p);
    if (*p++ != '}')
      return false;
    skipWhitespace(p);
    return *p == 0;
  }
  struct ButtonDebounce
  {
    bool rawHigh = true, stableHigh = true;
    uint32_t changed = 0;
    bool update(bool high, uint32_t now)
    {
      if (high != rawHigh)
      {
        rawHigh = high;
        changed = now;
      }
      if (high != stableHigh && uint32_t(now - changed) >= 35)
      {
        stableHigh = high;
        return !high;
      }
      return false;
    }
  };
  struct TonePattern
  {
    bool wasAlarm = false;
    uint32_t started = 0;
    unsigned update(bool alarm, uint32_t now)
    {
      if (alarm && !wasAlarm)
        started = now;
      wasAlarm = alarm;
      return alarm ? ((uint32_t(now - started) / 150) % 2 ? 600u : 900u) : 0u;
    }
  };
  struct AlarmCore
  {
    static constexpr int32_t threshold = 65000;
    bool alarm = false, sensorOk = false;
    int16_t ax = 0, ay = 0, az = 0;
    int32_t horizontal = 0, peak = 0;
    uint32_t sequence = 0;
    size_t eventCount = 0, head = 0;
    Event events[32];
    static int32_t magnitude(int16_t v)
    {
      return v < 0 ? -int32_t(v) : int32_t(v);
    }
    bool green() const
    {
      return sensorOk && !alarm;
    }
    const Event &event(size_t newestIndex) const
    {
      return events[(head + 31 - newestIndex) % 32];
    }
    void record(uint32_t now, bool impact, Source source)
    {
      events[head] = {++sequence, now, horizontal, impact, source};
      head = (head + 1) % 32;
      if (eventCount < 32)
        ++eventCount;
    }
    void sample(int16_t x, int16_t y, int16_t z, bool valid, uint32_t now)
    {
      sensorOk = valid;
      if (!valid)
        return;
      ax = x;
      ay = y;
      az = z;
      horizontal = magnitude(x) + magnitude(y);
      if (horizontal > peak)
        peak = horizontal;
      if (horizontal > threshold && !alarm)
      {
        alarm = true;
        record(now, true, Source::Sensor);
      }
    }
    void reset(uint32_t now, Source source)
    {
      alarm = false;
      record(now, false, source);
    }
  };
}