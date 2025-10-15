# Sensors API Usage Guide

## Basic Usage

### 1. **Get all data (last 24 hours)**
```bash
GET /api/sensors/data
```

### 2. **Filter by sensor box**
```bash
GET /api/sensors/data?sensor_box=box_001
```

### 3. **Filter by sensor type**
```bash
GET /api/sensors/data?sensor_type=temperature
```

### 4. **Filter by both sensor box and type**
```bash
GET /api/sensors/data?sensor_box=box_001&sensor_type=temperature
```

## Advanced Filtering

### 5. **Time range filtering**
```bash
# Last 2 hours
GET /api/sensors/data?start_time=-2h

# Specific time range
GET /api/sensors/data?start_time=2024-01-01T00:00:00Z&end_time=2024-01-02T00:00:00Z

# Last week
GET /api/sensors/data?start_time=-7d
```

### 6. **Limit results**
```bash
# Get only 10 most recent records
GET /api/sensors/data?limit=10

# Get 50 temperature readings from box_001
GET /api/sensors/data?sensor_box=box_001&sensor_type=temperature&limit=50
```

## Complete Examples

### 7. **Complex filtering**
```bash
# Get last 100 temperature readings from box_001 in the last 6 hours
GET /api/sensors/data?sensor_box=box_001&sensor_type=temperature&start_time=-6h&limit=100
```

### 8. **JavaScript/Fetch examples**
```javascript
// Get all data
const response = await fetch('/api/sensors/data');

// Get temperature data from specific box
const response = await fetch('/api/sensors/data?sensor_box=box_001&sensor_type=temperature');

// Get data from last 2 hours with limit
const response = await fetch('/api/sensors/data?start_time=-2h&limit=20');
```

### 9. **cURL examples**
```bash
# Basic request
curl "https://localhost:8081/api/sensors/data"

# With filters
curl "https://localhost:8081/api/sensors/data?sensor_box=box_001&sensor_type=temperature&limit=10"

# With time range
curl "https://localhost:8081/api/sensors/data?start_time=-1h&end_time=now()"
```

## Time Format Options

The `start_time` and `end_time` parameters accept:
- **Relative time**: `-1h`, `-2d`, `-30m`, `-1w`
- **Absolute time**: `2024-01-01T00:00:00Z`, `2024-01-01T00:00:00`
- **now()**: Current time

## Response Format

All filtered requests return data in this format:
```json
[
  {
    "timestamp": "2024-01-01T12:00:00Z",
    "sensor_box": "box_001",
    "sensor_type": "temperature",
    "value": 23.5
  },
  {
    "timestamp": "2024-01-01T12:01:00Z",
    "sensor_box": "box_001", 
    "sensor_type": "humidity",
    "value": 65.2
  }
]
```

## Error Handling

If you provide invalid parameters, you'll get appropriate error messages:
- Invalid time format
- Invalid sensor box/type (if they don't exist in data)
- Missing required authentication

The filtering is very flexible - you can combine any of these parameters as needed!

## Available Endpoints

### Data Retrieval
- `GET /api/sensors/data` - Get all sensor data with optional filtering
- `GET /api/sensors/data/box/:sensor_box` - Get data by sensor box
- `GET /api/sensors/data/type/:sensor_type` - Get data by sensor type
- `GET /api/sensors/boxes` - Get all unique sensor boxes
- `GET /api/sensors/types` - Get all unique sensor types

### Data Writing
- `POST /api/sensors/data` - Write new sensor data
- `GET /api/sensors/writeTestData` - Generate test data

### Authentication
All endpoints require authentication. Make sure to include your session cookie in requests.

## Query Parameters Reference

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `sensor_box` | string | Filter by sensor box ID | `box_001` |
| `sensor_type` | string | Filter by sensor type | `temperature` |
| `start_time` | string | Start time for data range | `-24h`, `2024-01-01T00:00:00Z` |
| `end_time` | string | End time for data range | `now()`, `2024-01-02T00:00:00Z` |
| `limit` | number | Maximum number of results | `100` |
