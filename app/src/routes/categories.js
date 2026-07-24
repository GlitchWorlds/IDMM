'use strict';

const express = require('express');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const router = express.Router();

const CATEGORIES_FILE = path.join(__dirname, '..', '..', 'data', 'categories.json');

const DEFAULT_CATEGORIES = [
  { id: 'videos', name: 'Videos', color: '#ef4444', icon: 'video', isDefault: true },
  { id: 'music', name: 'Music', color: '#f59e0b', icon: 'music', isDefault: true },
  { id: 'documents', name: 'Documents', color: '#3b82f6', icon: 'file-text', isDefault: true },
  { id: 'archives', name: 'Archives', color: '#8b5cf6', icon: 'archive', isDefault: true },
  { id: 'software', name: 'Software', color: '#10b981', icon: 'download', isDefault: true },
  { id: 'others', name: 'Others', color: '#6b7280', icon: 'folder', isDefault: true },
];

/**
 * Load categories from JSON file, seeding defaults if file doesn't exist.
 * @returns {Array}
 */
function loadCategories() {
  try {
    if (!fs.existsSync(CATEGORIES_FILE)) {
      fs.writeFileSync(CATEGORIES_FILE, JSON.stringify(DEFAULT_CATEGORIES, null, 2), 'utf-8');
      return [...DEFAULT_CATEGORIES];
    }
    const raw = fs.readFileSync(CATEGORIES_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) {
      return [...DEFAULT_CATEGORIES];
    }
    return data;
  } catch (err) {
    console.error('[Categories] Failed to load:', err.message);
    return [...DEFAULT_CATEGORIES];
  }
}

/**
 * Save categories to JSON file.
 * @param {Array} categories
 */
async function saveCategories(categories) {
  const dir = path.dirname(CATEGORIES_FILE);
  if (!fs.existsSync(dir)) {
    await fsp.mkdir(dir, { recursive: true });
  }
  await fsp.writeFile(CATEGORIES_FILE, JSON.stringify(categories, null, 2), 'utf-8');
}

/**
 * Generate a unique category ID from name.
 * @param {string} name
 * @returns {string}
 */
function generateCategoryId(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${slug}-${suffix}`;
}

/**
 * Factory function to create the categories router.
 * Dependencies are optional — categories are stored in a standalone JSON file.
 * @returns {express.Router}
 */
function createCategoriesRouter() {
  const categoriesRouter = express.Router();

  // Ensure categories file exists with defaults on first load
  loadCategories();

  /**
   * GET /api/categories
   *
   * List all categories.
   */
  categoriesRouter.get('/', (req, res) => {
    try {
      const categories = loadCategories();
      res.json(categories);
    } catch (err) {
      console.error('[Categories] GET error:', err.message);
      res.status(500).json({ error: 'Failed to retrieve categories' });
    }
  });

  /**
   * POST /api/categories
   *
   * Body: { name, color?, icon? }
   *
   * Create a custom category.
   */
  categoriesRouter.post('/', async (req, res) => {
    try {
      const { name, color, icon } = req.body || {};

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'name is required' });
      }

      if (name.length > 50) {
        return res.status(400).json({ error: 'name must be 50 characters or less' });
      }

      const categories = loadCategories();

      // Check for duplicate name (case-insensitive)
      const exists = categories.some(c => c.name.toLowerCase() === name.toLowerCase());
      if (exists) {
        return res.status(409).json({ error: 'Category with this name already exists' });
      }

      const category = {
        id: generateCategoryId(name),
        name: name.trim(),
        color: color || '#6b7280',
        icon: icon || 'folder',
        isDefault: false,
      };

      categories.push(category);
      await saveCategories(categories);

      res.status(201).json(category);
    } catch (err) {
      console.error('[Categories] POST error:', err.message);
      res.status(500).json({ error: 'Failed to create category' });
    }
  });

  /**
   * PUT /api/categories/:id
   *
   * Body: { name?, color?, icon? }
   *
   * Update a category (cannot update default categories' name).
   */
  categoriesRouter.put('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { name, color, icon } = req.body || {};
      const categories = loadCategories();

      const category = categories.find(c => c.id === id);
      if (!category) {
        return res.status(404).json({ error: 'Category not found' });
      }

      // Cannot rename default categories
      if (category.isDefault && name && name !== category.name) {
        return res.status(403).json({ error: 'Cannot rename default categories' });
      }

      if (name !== undefined) {
        if (typeof name !== 'string' || name.trim().length === 0) {
          return res.status(400).json({ error: 'name must be a non-empty string' });
        }
        if (name.length > 50) {
          return res.status(400).json({ error: 'name must be 50 characters or less' });
        }
        // Check for duplicate name (case-insensitive, excluding self)
        const dup = categories.some(c => c.id !== id && c.name.toLowerCase() === name.toLowerCase());
        if (dup) {
          return res.status(409).json({ error: 'Category with this name already exists' });
        }
        category.name = name.trim();
      }

      if (color !== undefined) {
        category.color = color;
      }

      if (icon !== undefined) {
        category.icon = icon;
      }

      await saveCategories(categories);

      res.json(category);
    } catch (err) {
      console.error('[Categories] PUT error:', err.message);
      res.status(500).json({ error: 'Failed to update category' });
    }
  });

  /**
   * DELETE /api/categories/:id
   *
   * Delete a custom category. Default categories cannot be deleted.
   */
  categoriesRouter.delete('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const categories = loadCategories();

      const category = categories.find(c => c.id === id);
      if (!category) {
        return res.status(404).json({ error: 'Category not found' });
      }

      if (category.isDefault) {
        return res.status(403).json({ error: 'Cannot delete default categories' });
      }

      const filtered = categories.filter(c => c.id !== id);
      await saveCategories(filtered);

      res.json({ id, deleted: true });
    } catch (err) {
      console.error('[Categories] DELETE error:', err.message);
      res.status(500).json({ error: 'Failed to delete category' });
    }
  });

  return categoriesRouter;
}

module.exports = router;
module.exports.createCategoriesRouter = createCategoriesRouter;
module.exports.loadCategories = loadCategories;
module.exports.saveCategories = saveCategories;
module.exports.DEFAULT_CATEGORIES = DEFAULT_CATEGORIES;
