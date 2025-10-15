# API Endpoints Reference

## Base URLs
- **Main API**: `https://localhost:8081/api`
- **Testing**: `https://localhost:8081/testing`

---

## User Management (`/api/users`)

### Authentication Required
All endpoints except `/register` and `/login` require authentication.

### Endpoints

| Method | Endpoint | Auth Required | Role Required | Description |
|--------|----------|---------------|---------------|-------------|
| `GET` | `/api/users/all` | ✅ | admin | Get all users |
| `POST` | `/api/users/register` | ❌ | - | Register new user |
| `POST` | `/api/users/login` | ❌ | - | User login |
| `POST` | `/api/users/logout` | ✅ | - | User logout |
| `GET` | `/api/users/me` | ✅ | - | Get current user info |

### Request/Response Examples

#### Register User
```http
POST /api/users/register
Content-Type: application/json

{
  "user": "username",
  "password": "password",
  "role": "user"
}
```

#### Login
```http
POST /api/users/login
Content-Type: application/json

{
  "user": "username",
  "password": "password"
}
```

#### Get Current User
```http
GET /api/users/me
Cookie: connect.sid=session_cookie
```

---

## Sensors (`/api/sensors`)

### Authentication Required
All sensor endpoints require authentication.

### Data Retrieval Endpoints

| Method | Endpoint | Description | Query Parameters |
|--------|----------|-------------|------------------|
| `GET` | `/api/sensors/data` | Get all sensor data with filtering | `sensor_box`, `sensor_type`, `start_time`, `end_time`, `limit` |
| `GET` | `/api/sensors/data/box/:sensor_box` | Get data by sensor box | `sensor_type`, `start_time`, `end_time`, `limit` |
| `GET` | `/api/sensors/data/type/:sensor_type` | Get data by sensor type | `sensor_box`, `start_time`, `end_time`, `limit` |
| `GET` | `/api/sensors/boxes` | Get all unique sensor boxes | - |
| `GET` | `/api/sensors/types` | Get all unique sensor types | - |

### Data Writing Endpoints

| Method | Endpoint | Description | Request Body |
|--------|----------|-------------|--------------|
| `POST` | `/api/sensors/data` | Write new sensor data | `sensor_box`, `sensor_type`, `value` |
| `GET` | `/api/sensors/writeTestData` | Generate test data | - |

### Health Check

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/sensors/` | Health check endpoint |

### Request/Response Examples

#### Get All Data
```http
GET /api/sensors/data?sensor_box=box_001&sensor_type=temperature&limit=10
Cookie: connect.sid=session_cookie
```

#### Write Sensor Data
```http
POST /api/sensors/data
Content-Type: application/json
Cookie: connect.sid=session_cookie

{
  "sensor_box": "box_001",
  "sensor_type": "temperature",
  "value": 23.5
}
```

#### Response Format
```json
[
  {
    "timestamp": "2024-01-01T12:00:00Z",
    "sensor_box": "box_001",
    "sensor_type": "temperature",
    "value": 23.5
  }
]
```

---

## Testing (`/testing`)

### Endpoints

| Method | Endpoint | Auth Required | Description |
|--------|----------|---------------|-------------|
| `GET` | `/testing/` | ✅ | Test endpoint with authentication |
| `GET` | `/testing/users` | ❌ | HTML test page for users API |

### Usage

The testing endpoints are primarily for development and testing purposes.

---

## Authentication

### Session-Based Authentication
- Uses HTTP-only cookies for session management
- Session cookie name: `connect.sid`
- Session duration: 2 hours
- Secure: HTTPS only
- SameSite: Lax

### Login Flow
1. POST to `/api/users/login` with credentials
2. Server sets session cookie
3. Include cookie in subsequent requests

### Logout Flow
1. POST to `/api/users/logout`
2. Server destroys session and clears cookie

---

## Error Responses

### Common Error Codes
- `400` - Bad Request (missing required fields)
- `401` - Unauthorized (not logged in)
- `403` - Forbidden (insufficient permissions)
- `500` - Internal Server Error

### Error Response Format
```json
{
  "error": "Error message description"
}
```

---

## Query Parameters Reference

### Time Formats
- **Relative**: `-1h`, `-2d`, `-30m`, `-1w`
- **Absolute**: `2024-01-01T00:00:00Z`
- **Current**: `now()`

### Sensor Data Filters
- `sensor_box`: Filter by sensor box ID
- `sensor_type`: Filter by sensor type (temperature, humidity, etc.)
- `start_time`: Start time for data range
- `end_time`: End time for data range
- `limit`: Maximum number of results

---

## CORS Configuration
- **Allowed Origins**: `http://localhost:5173`, `https://localhost:5173`
- **Credentials**: Enabled
- **Methods**: All standard HTTP methods
