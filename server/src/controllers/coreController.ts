import type { Request, Response } from 'express';
import { coreModels, isCoreResource } from '../models/CoreModels.js';

function resolveModel(req: Request, res: Response) {
  const resource = String(req.params.resource);
  if (!isCoreResource(resource)) {
    res.status(404).json({ success: false, message: `Unknown resource: ${resource}` });
    return null;
  }
  return coreModels[resource];
}

export const coreController = {
  /** GET /api/data/:resource */
  async getAll(req: Request, res: Response) {
    const model = resolveModel(req, res);
    if (!model) return;
    try {
      const data = await model.getAll();
      res.json({ success: true, data });
    } catch (err) {
      console.error(`[Core] getAll ${req.params.resource} error:`, err);
      res.status(500).json({ success: false, message: 'Failed to fetch records' });
    }
  },

  /** POST /api/data/:resource — insert or overwrite by id */
  async upsert(req: Request, res: Response) {
    const model = resolveModel(req, res);
    if (!model) return;
    try {
      const record = req.body;
      if (!record?.id) {
        return res.status(400).json({ success: false, message: 'id is required' });
      }
      const data = await model.upsert(record);
      return res.json({ success: true, data });
    } catch (err) {
      console.error(`[Core] upsert ${req.params.resource} error:`, err);
      return res.status(500).json({ success: false, message: 'Failed to save record' });
    }
  },

  /** POST /api/data/:resource/bulk — replace many records at once */
  async bulkUpsert(req: Request, res: Response) {
    const model = resolveModel(req, res);
    if (!model) return;
    try {
      const { records } = req.body as { records?: unknown };
      if (!Array.isArray(records)) {
        return res.status(400).json({ success: false, message: 'records must be an array' });
      }
      const withIds = records.filter((r): r is Record<string, unknown> =>
        Boolean(r && typeof r === 'object' && (r as Record<string, unknown>).id),
      );
      const data = await model.bulkUpsert(withIds);
      return res.json({ success: true, data, count: data.length });
    } catch (err) {
      console.error(`[Core] bulkUpsert ${req.params.resource} error:`, err);
      return res.status(500).json({ success: false, message: 'Failed to bulk save records' });
    }
  },

  /** PATCH /api/data/:resource/:id */
  async update(req: Request, res: Response) {
    const model = resolveModel(req, res);
    if (!model) return;
    try {
      const data = await model.updateById(String(req.params.id), req.body ?? {});
      if (!data) {
        return res.status(404).json({ success: false, message: 'Record not found' });
      }
      return res.json({ success: true, data });
    } catch (err) {
      console.error(`[Core] update ${req.params.resource} error:`, err);
      return res.status(500).json({ success: false, message: 'Failed to update record' });
    }
  },

  /** DELETE /api/data/:resource/:id */
  async delete(req: Request, res: Response) {
    const model = resolveModel(req, res);
    if (!model) return;
    try {
      await model.deleteById(String(req.params.id));
      res.json({ success: true });
    } catch (err) {
      console.error(`[Core] delete ${req.params.resource} error:`, err);
      res.status(500).json({ success: false, message: 'Failed to delete record' });
    }
  },
};
