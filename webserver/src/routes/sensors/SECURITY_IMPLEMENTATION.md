# InfluxDB Query Security Implementation

## Overview
This document describes the security measures implemented to protect against Flux query injection attacks in the InfluxDB integration.

## Security Measures

### 1. Input Validation and Sanitization

All user inputs are validated and sanitized before being used in Flux queries:

#### Sensor Identifiers
- **`sensor_box`** and **`sensor_type`**: 
  - Allowed characters: alphanumeric, underscore, hyphen, dot
  - Maximum length: 255 characters
  - Special characters and Flux operators are stripped
  - Invalid inputs are rejected with 400 status codes

#### Time Expressions
- **`start_time`** and **`end_time`**:
  - Valid formats:
    - Relative time: `-1h`, `-24h`, `-7d`, `-30d` (max 1 year)
    - RFC3339 timestamps: `2025-11-18T20:00:00Z`
    - `now()` function
  - Invalid inputs default to safe values (`-24h` for start, `now()` for end)
  - Time ranges are limited to prevent resource exhaustion

#### Limit Values
- **`limit`**:
  - Must be a positive integer
  - Maximum value: 10,000 (prevents resource exhaustion)
  - Invalid values default to 10,000

### 2. String Escaping

All string values are properly escaped before insertion into Flux queries:
- Double quotes (`"`) → `\"`
- Backslashes (`\`) → `\\`
- Newlines, carriage returns, and tabs are escaped
- Prevents injection of Flux code through string values

### 3. Parameterized Query Building

The `buildSecureFluxQuery()` function constructs queries using a secure builder pattern:
- No direct string concatenation with user input
- All inputs are validated before use
- Query structure is fixed, only values are parameterized

### 4. Security Logging

All potential injection attempts are logged with:
- User identification (username or anonymous)
- IP address
- Field name and value
- Reason for rejection

Example log entry:
```
[SECURITY] Potential injection attempt detected - User: admin, IP: 192.168.1.100, Field: sensor_box, Value: "box\"; drop table", Reason: Invalid characters or format
```

### 5. Output Sanitization

Query results are also sanitized before being returned to clients:
- Sensor box and type values are validated on output
- Prevents XSS and other injection attacks through data

## Implementation Details

### Secure Query Builder

```javascript
import { buildSecureFluxQuery } from './utils.js';

// All inputs are automatically sanitized
const query = buildSecureFluxQuery(bucket, {
    sensor_box: req.query.sensor_box,      // Sanitized automatically
    sensor_type: req.query.sensor_type,    // Sanitized automatically
    start_time: req.query.start_time,      // Validated automatically
    end_time: req.query.end_time,          // Validated automatically
    limit: req.query.limit                 // Validated automatically
});
```

### Manual Sanitization (for endpoints with path parameters)

```javascript
import { sanitizeSensorBox, sanitizeSensorType } from './utils.js';

const sanitizedBox = sanitizeSensorBox(req.params.sensor_box);
if (!sanitizedBox) {
    return res.status(400).json({ 
        error: 'Invalid sensor_box format' 
    });
}
```

## Protected Endpoints

All sensor data endpoints are protected:

1. **GET `/api/sensors/data`** - Query with optional filters
2. **GET `/api/sensors/data/box/:sensor_box`** - Query by sensor box
3. **GET `/api/sensors/data/type/:sensor_type`** - Query by sensor type
4. **GET `/api/sensors/boxes`** - List unique sensor boxes
5. **GET `/api/sensors/types`** - List unique sensor types
6. **POST `/api/sensors/data`** - Write sensor data

## Testing Security

### Injection Attempt Examples (All Should Fail)

1. **SQL-like injection**:
   ```
   GET /api/sensors/data?sensor_box=box"; drop measurement sensor_data
   ```
   Result: Invalid characters stripped, query fails safely

2. **Flux code injection**:
   ```
   GET /api/sensors/data?sensor_box=box" |> union(tables: [other_bucket])
   ```
   Result: Special characters removed, only "box" used

3. **Time manipulation**:
   ```
   GET /api/sensors/data?start_time=-999999d
   ```
   Result: Time limited to max 1 year, defaults to `-24h`

4. **Limit exhaustion**:
   ```
   GET /api/sensors/data?limit=999999999
   ```
   Result: Limited to 10,000 maximum

## Security Compliance

✅ **OWASP A03:2021 - Injection**
- All inputs validated and sanitized
- No dynamic query construction from user input
- Parameterized query building

✅ **CIA Triad**
- **Confidentiality**: Invalid queries rejected, preventing data leakage
- **Integrity**: Query structure protected, preventing data manipulation
- **Availability**: Resource limits prevent DoS attacks

## Maintenance Notes

- All code uses `buildSecureFluxQuery()` - the old insecure `buildFluxQuery()` has been removed
- Security logging should be monitored for patterns indicating attack attempts
- Regular security audits should verify no new injection vectors are introduced
- When adding new query parameters, ensure they are validated and sanitized before use

