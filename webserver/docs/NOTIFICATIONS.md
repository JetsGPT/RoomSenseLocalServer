# Notification System Documentation

## Overview

The RoomSense Notification System allows users to create rules that trigger notifications based on sensor data thresholds. The system follows a modular provider pattern, currently supporting ntfy.sh push notifications with the ability to easily add email, SMS, or other providers in the future.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Rule Engine                               │
│  (Background worker - evaluates rules periodically)             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐     ┌────────────────┐     ┌──────────────┐  │
│  │  PostgreSQL  │────▶│ Notification   │────▶│  InfluxDB    │  │
│  │   (Rules)    │     │   Service      │     │ (Sensor Data)│  │
│  └──────────────┘     └────────────────┘     └──────────────┘  │
│                              │                                   │
│                              ▼                                   │
│                    ┌─────────────────┐                          │
│                    │    Providers    │                          │
│                    ├─────────────────┤                          │
│                    │  ✓ NtfyProvider │                          │
│                    │  ○ EmailProvider│ (future)                 │
│                    │  ○ SMSProvider  │ (future)                 │
│                    └─────────────────┘                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. NotificationProvider (Base Class)
`src/services/notifications/NotificationProvider.js`

Abstract base class that all notification providers must extend. Defines the interface:
- `send(payload)` - Send a notification
- `validateTarget(target)` - Validate the notification target format
- `getName()` - Get the provider name

### 2. NtfyProvider
`src/services/notifications/providers/NtfyProvider.js`

Push notification provider using ntfy.sh service. Features:
- Supports public ntfy.sh server or self-hosted instances
- Priority levels (min, low, default, high, urgent, max)
- Custom tags and emoji
- Click actions and rich notifications

### 3. NotificationService
`src/services/notifications/NotificationService.js`

Central service for managing providers:
- Provider registration and lookup
- Notification payload building with template support
- Message formatting with sensor data interpolation

### 4. RuleEngine
`src/services/notifications/RuleEngine.js`

Background worker that:
- Periodically queries active rules from PostgreSQL
- Fetches latest sensor readings from InfluxDB
- Evaluates conditions and triggers notifications
- Manages cooldown periods to prevent notification spam
- Logs notification history for auditing

### 5. Notifications Router
`src/routes/notifications.js`

REST API for rule management:
- CRUD operations for notification rules
- Rule testing and manual triggering
- Notification history retrieval

## Database Schema

### notification_rules Table

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | INTEGER | Foreign key to users table |
| name | VARCHAR(255) | Rule name |
| sensor_id | VARCHAR(255) | Sensor box ID or '*' for all |
| sensor_type | VARCHAR(100) | Sensor type (temperature, humidity, etc.) |
| condition | VARCHAR(10) | Comparison operator (>, <, >=, <=, ==, !=) |
| threshold | NUMERIC(10,2) | Threshold value |
| notification_provider | VARCHAR(50) | Provider name (ntfy, email, sms) |
| notification_target | VARCHAR(255) | Provider-specific target |
| notification_priority | VARCHAR(20) | Priority level |
| notification_title | VARCHAR(255) | Custom title template (optional) |
| notification_message | TEXT | Custom message template (optional) |
| cooldown_seconds | INTEGER | Minimum time between notifications |
| is_enabled | BOOLEAN | Whether the rule is active |
| last_triggered_at | TIMESTAMP | Last trigger time |
| trigger_count | INTEGER | Total trigger count |
| created_at | TIMESTAMP | Creation timestamp |
| updated_at | TIMESTAMP | Last update timestamp |

### notification_history Table

Stores a log of all notification attempts for auditing and debugging.

## API Endpoints

### Rules Management

#### List Rules
```
GET /api/notifications/rules
```
Returns all rules for the authenticated user.

#### Get Rule
```
GET /api/notifications/rules/:id
```
Returns a specific rule.

#### Create Rule
```
POST /api/notifications/rules
Content-Type: application/json

{
  "name": "High Temperature Alert",
  "sensor_id": "box_001",         // or "*" for all sensors
  "sensor_type": "temperature",
  "condition": ">",
  "threshold": 25,
  "notification_provider": "ntfy", // optional, defaults to "ntfy"
  "notification_target": "my-topic",
  "notification_priority": "high", // optional
  "cooldown_seconds": 300,         // optional, default 5 min
  "is_enabled": true               // optional, default true
}
```

#### Update Rule
```
PUT /api/notifications/rules/:id
Content-Type: application/json

{
  "threshold": 30,
  "is_enabled": false
}
```

#### Delete Rule
```
DELETE /api/notifications/rules/:id
```

### Testing & Debugging

#### Test Rule (Dry Run)
```
POST /api/notifications/rules/:id/test
```
Evaluates the rule against current sensor data without sending a notification.

#### Trigger Rule Manually
```
POST /api/notifications/rules/:id/trigger
```
Sends a test notification regardless of current sensor values.

### History & Status

#### Get Notification History
```
GET /api/notifications/history?limit=50&offset=0&status=sent
```
Query parameters:
- `limit`: Max results (default 50, max 500)
- `offset`: Pagination offset
- `status`: Filter by status (sent, failed, cooldown_skipped)

#### Get Available Providers
```
GET /api/notifications/providers
```

#### Get Engine Status
```
GET /api/notifications/status
```

## Custom Message Templates

Notification title and message support template variables:

- `{{sensor_type}}` - The sensor type (temperature, humidity, etc.)
- `{{sensor_id}}` - The sensor box identifier
- `{{value}}` - Current sensor value
- `{{threshold}}` - Rule threshold value
- `{{condition}}` - Rule condition operator
- `{{name}}` - Rule name

Example custom message:
```
🌡️ {{sensor_type}} alert!
Sensor {{sensor_id}} reading: {{value}}
Threshold: {{threshold}}
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| RULE_CHECK_INTERVAL_MS | 60000 | Rule evaluation interval (ms) |
| NTFY_BASE_URL | https://ntfy.sh | Ntfy server URL |
| NTFY_ACCESS_TOKEN | - | Optional ntfy authentication token |

## Adding New Providers

To add a new notification provider (e.g., Email):

1. Create `src/services/notifications/providers/EmailProvider.js`:

```javascript
import { NotificationProvider } from '../NotificationProvider.js';

export class EmailProvider extends NotificationProvider {
    constructor(options = {}) {
        super('email');
        // Initialize SMTP settings
    }

    async send(payload) {
        const { target, title, message } = payload;
        // Send email via SMTP
        return { success: true, messageId: '...' };
    }

    validateTarget(target) {
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(target);
    }
}
```

2. Register in `NotificationService.js`:

```javascript
import { EmailProvider } from './providers/EmailProvider.js';

// In initialize():
this.registerProvider(new EmailProvider());
```

3. Update database permissions if needed.

## Security

- All endpoints require authentication (`requireLogin`)
- Rate limiting via `ratePermissions` middleware
- CSRF protection on POST/PUT/DELETE
- User isolation - users can only access their own rules
- Input validation and sanitization
- SQL injection prevention via parameterized queries

## Troubleshooting

### Notifications Not Sending

1. Check rule is enabled: `is_enabled = true`
2. Check cooldown period hasn't expired
3. Verify sensor data exists in InfluxDB
4. Check rule engine status: `GET /api/notifications/status`
5. Review notification history for errors

### Rule Engine Not Starting

1. Ensure PostgreSQL connection is working
2. Check InfluxDB connectivity
3. Review server logs for initialization errors

### Invalid Target Errors

- **ntfy**: Topic must be 1-64 alphanumeric characters with underscores/hyphens
- **email**: Must be valid email format
- **sms**: Must be valid phone number format

