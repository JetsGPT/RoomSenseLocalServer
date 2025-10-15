# Utility Functions Usage Guide

## Overview

The utility functions `buildFluxQuery` and `formatSensorData` are defined in `routes/sensors/utils.js` and are used throughout the data retrieval endpoints to reduce code duplication and improve maintainability.

## Functions

### 1. `buildFluxQuery(baseQuery, filters)`

**Purpose**: Builds a complete Flux query by adding filters to a base query.

**Parameters**:
- `baseQuery` (string): The base Flux query
- `filters` (object): Object containing filter options
  - `sensor_box` (string): Filter by sensor box
  - `sensor_type` (string): Filter by sensor type  
  - `limit` (number): Limit number of results

**Usage Examples**:

```javascript
// Basic usage
const baseQuery = `from(bucket: "sensors_data")
 |> range(start: -24h, stop: now())
 |> filter(fn: (r) => r._measurement == "sensor_data")`;

const fluxQuery = buildFluxQuery(baseQuery, { 
  sensor_box: "box_001", 
  sensor_type: "temperature", 
  limit: 100 
});
```

**Where it's used**:
- `GET /data` - Main data endpoint
- `GET /data/box/:sensor_box` - Sensor box specific data
- `GET /data/type/:sensor_type` - Sensor type specific data

### 2. `formatSensorData(tableObject)`

**Purpose**: Formats InfluxDB query result into a standardized sensor data object.

**Parameters**:
- `tableObject` (object): Raw InfluxDB query result object

**Returns**:
```javascript
{
  timestamp: "2024-01-01T12:00:00Z",
  sensor_box: "box_001", 
  sensor_type: "temperature",
  value: 23.5
}
```

**Usage Examples**:

```javascript
// In query callback
queryClient.queryRows(fluxQuery, {
  next: (row, tableMeta) => {
    const tableObject = tableMeta.toObject(row);
    data.push(formatSensorData(tableObject));
  }
});
```

**Where it's used**:
- All data retrieval endpoints to format response data consistently

## Code Before vs After

### Before (Duplicated Code):
```javascript
// In each endpoint - repeated code
let fluxQuery = `from(bucket: "${bucket}")
 |> range(start: ${start_time || '-24h'}, stop: ${end_time || 'now()'})
 |> filter(fn: (r) => r._measurement == "sensor_data")`;

if (sensor_box) {
    fluxQuery += ` |> filter(fn: (r) => r.sensor_box == "${sensor_box}")`;
}
if (sensor_type) {
    fluxQuery += ` |> filter(fn: (r) => r.sensor_type == "${sensor_type}")`;
}
if (limit) {
    fluxQuery += ` |> limit(n: ${parseInt(limit)})`;
}

// Repeated formatting
data.push({
    timestamp: tableObject._time,
    sensor_box: tableObject.sensor_box,
    sensor_type: tableObject.sensor_type,
    value: tableObject._value
});
```

### After (Using Utilities):
```javascript
// Clean, reusable code
const baseQuery = `from(bucket: "${bucket}")
 |> range(start: ${start_time || '-24h'}, stop: ${end_time || 'now()'})
 |> filter(fn: (r) => r._measurement == "sensor_data")`;

const fluxQuery = buildFluxQuery(baseQuery, { sensor_box, sensor_type, limit });

// Clean formatting
data.push(formatSensorData(tableObject));
```

## Benefits

1. **DRY Principle**: Eliminates code duplication across endpoints
2. **Maintainability**: Changes to query building or data formatting only need to be made in one place
3. **Consistency**: Ensures all endpoints format data the same way
4. **Readability**: Makes endpoint code cleaner and easier to understand
5. **Testability**: Utility functions can be unit tested independently

## File Structure

```
routes/sensors/
├── utils.js              # Contains buildFluxQuery & formatSensorData
├── dataRetrieval.js      # Uses both utility functions
├── dataWriting.js        # Uses writeSensorData & writeTestData
├── influxClient.js       # InfluxDB configuration
└── index.js             # Main router
```

The utility functions are now actively used throughout the codebase, making it more maintainable and following best practices!
