import express from 'express';
import { requireLogin } from '../auth/auth.js';
import { randomUUID } from 'crypto';

const router = express.Router();

// Database connection pool (will be injected from app.js)
let pool = null;

// Enforce authentication on all routes
router.use(requireLogin);

/**
 * Initialize the database pool for this router
 * Called from app.js to inject the pool
 */
export function initDatabasePool(databasePool) {
    pool = databasePool;
}

/**
 * Helper: Verify floor plan ownership
 * Returns the floor plan if owned by user, null otherwise
 */
async function getFloorPlanIfOwned(floorPlanId, userId) {
    const result = await pool.query(
        'SELECT * FROM floor_plans WHERE id = $1 AND user_id = $2',
        [floorPlanId, userId]
    );
    return result.rows[0] || null;
}

/**
 * Helper: Format floor plan response with camelCase keys
 */
function formatFloorPlan(row) {
    return {
        id: row.id,
        name: row.name,
        floors: row.floors,
        viewSettings: row.view_settings,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

// ============================================
// FLOOR PLAN CRUD OPERATIONS
// ============================================

/**
 * GET /api/floor-plans
 * Get all floor plans for the current authenticated user
 */
router.get('/', async (req, res) => {
    const userId = req.session.user.id;

    try {
        const result = await pool.query(
            'SELECT * FROM floor_plans WHERE user_id = $1 ORDER BY updated_at DESC',
            [userId]
        );

        const floorPlans = result.rows.map(formatFloorPlan);
        return res.status(200).json(floorPlans);

    } catch (error) {
        console.error('[FloorPlans] Error fetching floor plans:', error);
        return res.status(500).json({ error: 'Internal server error', status: 500 });
    }
});

/**
 * GET /api/floor-plans/:id
 * Get a specific floor plan by ID with all its elements and sensors
 */
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    const userId = req.session.user.id;

    try {
        const floorPlan = await getFloorPlanIfOwned(id, userId);

        if (!floorPlan) {
            return res.status(404).json({ error: 'Floor plan not found', status: 404 });
        }

        return res.status(200).json(formatFloorPlan(floorPlan));

    } catch (error) {
        console.error('[FloorPlans] Error fetching floor plan:', error);
        return res.status(500).json({ error: 'Internal server error', status: 500 });
    }
});

/**
 * POST /api/floor-plans
 * Create a new floor plan
 */
router.post('/', async (req, res) => {
    const userId = req.session.user.id;
    const { name, floors, viewSettings, isActive } = req.body;

    // Validate required fields
    if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'Name is required', status: 400 });
    }

    try {
        // If this plan is set to be active, deactivate all others for this user first
        // We do this in a transaction-like manner (though not strict transaction here for simplicity, 
        // the unique index will prevent multiple active plans anyway)
        if (isActive === true) {
            await pool.query(
                'UPDATE floor_plans SET is_active = false WHERE user_id = $1',
                [userId]
            );
        }

        const result = await pool.query(
            `INSERT INTO floor_plans (user_id, name, floors, view_settings, is_active)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [
                userId,
                name.trim(),
                JSON.stringify(floors || []),
                JSON.stringify(viewSettings || { zoom: 1, panX: 0, panY: 0 }),
                isActive === true // Ensure boolean
            ]
        );

        const created = result.rows[0];
        console.log(`[FloorPlans] Created floor plan ${created.id} for user ${userId}`);

        return res.status(201).json(formatFloorPlan(created));

    } catch (error) {
        console.error('[FloorPlans] Error creating floor plan:', error);
        return res.status(500).json({ error: 'Internal server error', status: 500 });
    }
});

/**
 * PUT /api/floor-plans/:id
 * Update an existing floor plan. Supports partial updates.
 */
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const userId = req.session.user.id;
    const { name, floors, viewSettings, isActive } = req.body;

    try {
        // Verify ownership first
        const existing = await getFloorPlanIfOwned(id, userId);
        if (!existing) {
            return res.status(404).json({ error: 'Floor plan not found', status: 404 });
        }

        // If setting to active, deactivate all others first
        if (isActive === true) {
            await pool.query(
                'UPDATE floor_plans SET is_active = false WHERE user_id = $1',
                [userId]
            );
        }

        // Build dynamic update query for partial updates
        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (name !== undefined) {
            updates.push(`name = $${paramIndex++}`);
            values.push(name.trim());
        }
        if (floors !== undefined) {
            updates.push(`floors = $${paramIndex++}`);
            values.push(JSON.stringify(floors));
        }
        if (viewSettings !== undefined) {
            updates.push(`view_settings = $${paramIndex++}`);
            values.push(JSON.stringify(viewSettings));
        }
        if (isActive !== undefined) {
            updates.push(`is_active = $${paramIndex++}`);
            values.push(isActive === true);
        }

        if (updates.length === 0) {
            // Nothing to update, return existing
            return res.status(200).json(formatFloorPlan(existing));
        }

        // Add the WHERE clause parameters
        values.push(id);
        values.push(userId);

        const result = await pool.query(
            `UPDATE floor_plans 
             SET ${updates.join(', ')}, updated_at = NOW()
             WHERE id = $${paramIndex++} AND user_id = $${paramIndex}
             RETURNING *`,
            values
        );

        return res.status(200).json(formatFloorPlan(result.rows[0]));

    } catch (error) {
        console.error('[FloorPlans] Error updating floor plan:', error);
        return res.status(500).json({ error: 'Internal server error', status: 500 });
    }
});

/**
 * DELETE /api/floor-plans/:id
 * Delete a floor plan
 */
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const userId = req.session.user.id;

    try {
        const result = await pool.query(
            'DELETE FROM floor_plans WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Floor plan not found', status: 404 });
        }

        console.log(`[FloorPlans] Deleted floor plan ${id}`);
        return res.status(204).send();

    } catch (error) {
        console.error('[FloorPlans] Error deleting floor plan:', error);
        return res.status(500).json({ error: 'Internal server error', status: 500 });
    }
});

// ============================================
// SENSOR PLACEMENT OPERATIONS
// ============================================

/**
 * GET /api/floor-plans/:floorPlanId/sensors
 * Get all sensor placements for a floor plan (across all floors)
 */
router.get('/:floorPlanId/sensors', async (req, res) => {
    const { floorPlanId } = req.params;
    const userId = req.session.user.id;

    try {
        const floorPlan = await getFloorPlanIfOwned(floorPlanId, userId);
        if (!floorPlan) {
            return res.status(404).json({ error: 'Floor plan not found', status: 404 });
        }

        // Extract all sensors from all floors
        const sensors = [];
        const floors = floorPlan.floors || [];

        for (const floor of floors) {
            const floorSensors = floor.sensors || [];
            for (const sensor of floorSensors) {
                sensors.push({
                    id: sensor.id,
                    floorId: floor.id,
                    sensorBoxId: sensor.sensorBoxId,
                    position: sensor.position,
                    label: sensor.label
                });
            }
        }

        return res.status(200).json(sensors);

    } catch (error) {
        console.error('[FloorPlans] Error fetching sensors:', error);
        return res.status(500).json({ error: 'Internal server error', status: 500 });
    }
});

/**
 * POST /api/floor-plans/:floorPlanId/sensors
 * Add a sensor placement to a floor plan
 */
router.post('/:floorPlanId/sensors', async (req, res) => {
    const { floorPlanId } = req.params;
    const userId = req.session.user.id;
    const { floorId, sensorBoxId, position, label } = req.body;

    // Validate required fields
    if (!floorId || !sensorBoxId || !position) {
        return res.status(400).json({
            error: 'Missing required fields: floorId, sensorBoxId, position',
            status: 400
        });
    }

    try {
        const floorPlan = await getFloorPlanIfOwned(floorPlanId, userId);
        if (!floorPlan) {
            return res.status(404).json({ error: 'Floor plan not found', status: 404 });
        }

        const floors = floorPlan.floors || [];
        const floorIndex = floors.findIndex(f => f.id === floorId);

        if (floorIndex === -1) {
            return res.status(404).json({ error: 'Floor not found', status: 404 });
        }

        // Generate new sensor placement
        const newSensor = {
            id: randomUUID(),
            sensorBoxId,
            position,
            label: label || ''
        };

        // Add sensor to the floor
        if (!floors[floorIndex].sensors) {
            floors[floorIndex].sensors = [];
        }
        floors[floorIndex].sensors.push(newSensor);

        // Update the floor plan
        await pool.query(
            'UPDATE floor_plans SET floors = $1, updated_at = NOW() WHERE id = $2',
            [JSON.stringify(floors), floorPlanId]
        );

        console.log(`[FloorPlans] Added sensor ${newSensor.id} to floor plan ${floorPlanId}`);

        return res.status(201).json({
            id: newSensor.id,
            floorId,
            sensorBoxId: newSensor.sensorBoxId,
            position: newSensor.position,
            label: newSensor.label
        });

    } catch (error) {
        console.error('[FloorPlans] Error adding sensor:', error);
        return res.status(500).json({ error: 'Internal server error', status: 500 });
    }
});

/**
 * PUT /api/floor-plans/:floorPlanId/sensors/:sensorId
 * Update a sensor placement's position or label
 */
router.put('/:floorPlanId/sensors/:sensorId', async (req, res) => {
    const { floorPlanId, sensorId } = req.params;
    const userId = req.session.user.id;
    const { position, label } = req.body;

    try {
        const floorPlan = await getFloorPlanIfOwned(floorPlanId, userId);
        if (!floorPlan) {
            return res.status(404).json({ error: 'Floor plan not found', status: 404 });
        }

        const floors = floorPlan.floors || [];
        let sensorFound = false;
        let updatedSensor = null;
        let sensorFloorId = null;

        // Find and update the sensor
        for (const floor of floors) {
            const sensors = floor.sensors || [];
            const sensorIndex = sensors.findIndex(s => s.id === sensorId);

            if (sensorIndex !== -1) {
                sensorFound = true;
                sensorFloorId = floor.id;

                if (position !== undefined) {
                    sensors[sensorIndex].position = position;
                }
                if (label !== undefined) {
                    sensors[sensorIndex].label = label;
                }

                updatedSensor = sensors[sensorIndex];
                break;
            }
        }

        if (!sensorFound) {
            return res.status(404).json({ error: 'Sensor not found', status: 404 });
        }

        // Update the floor plan
        await pool.query(
            'UPDATE floor_plans SET floors = $1, updated_at = NOW() WHERE id = $2',
            [JSON.stringify(floors), floorPlanId]
        );

        return res.status(200).json({
            id: updatedSensor.id,
            floorId: sensorFloorId,
            sensorBoxId: updatedSensor.sensorBoxId,
            position: updatedSensor.position,
            label: updatedSensor.label
        });

    } catch (error) {
        console.error('[FloorPlans] Error updating sensor:', error);
        return res.status(500).json({ error: 'Internal server error', status: 500 });
    }
});

/**
 * DELETE /api/floor-plans/:floorPlanId/sensors/:sensorId
 * Remove a sensor from a floor plan
 */
router.delete('/:floorPlanId/sensors/:sensorId', async (req, res) => {
    const { floorPlanId, sensorId } = req.params;
    const userId = req.session.user.id;

    try {
        const floorPlan = await getFloorPlanIfOwned(floorPlanId, userId);
        if (!floorPlan) {
            return res.status(404).json({ error: 'Floor plan not found', status: 404 });
        }

        const floors = floorPlan.floors || [];
        let sensorFound = false;

        // Find and remove the sensor
        for (const floor of floors) {
            if (!floor.sensors) continue;

            const sensorIndex = floor.sensors.findIndex(s => s.id === sensorId);
            if (sensorIndex !== -1) {
                floor.sensors.splice(sensorIndex, 1);
                sensorFound = true;
                break;
            }
        }

        if (!sensorFound) {
            return res.status(404).json({ error: 'Sensor not found', status: 404 });
        }

        // Update the floor plan
        await pool.query(
            'UPDATE floor_plans SET floors = $1, updated_at = NOW() WHERE id = $2',
            [JSON.stringify(floors), floorPlanId]
        );

        console.log(`[FloorPlans] Removed sensor ${sensorId} from floor plan ${floorPlanId}`);
        return res.status(204).send();

    } catch (error) {
        console.error('[FloorPlans] Error removing sensor:', error);
        return res.status(500).json({ error: 'Internal server error', status: 500 });
    }
});

export default router;
