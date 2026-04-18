import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import {
  getCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
  markAllSeenByCategory,
  createFeed,
  insertArticle,
  getArticles,
} from '../db.js'

beforeEach(() => {
  setupTestDb()
})

function seedArticle(feedId: number, overrides: Partial<Parameters<typeof insertArticle>[0]> = {}) {
  return insertArticle({
    feed_id: feedId,
    title: 'Test Article',
    url: `https://example.com/article/${Math.random()}`,
    published_at: '2025-01-01T00:00:00Z',
    ...overrides,
  })
}

// --- getCategories ---

describe('getCategories', () => {
  it('returns empty array when no categories exist', () => {
    expect(getCategories()).toEqual([])
  })

  it('returns categories ordered by sort_order then name', () => {
    createCategory('Banana')
    createCategory('Apple')
    createCategory('Cherry')

    const cats = getCategories()
    expect(cats).toHaveLength(3)
    // sort_order is auto-assigned 0, 1, 2 in creation order
    expect(cats[0].name).toBe('Banana')
    expect(cats[1].name).toBe('Apple')
    expect(cats[2].name).toBe('Cherry')
  })

  it('orders by name (case-insensitive) when sort_order is equal', () => {
    const a = createCategory('banana')
    const b = createCategory('Apple')
    // Set same sort_order
    updateCategory(a.id, { sort_order: 0 })
    updateCategory(b.id, { sort_order: 0 })

    const cats = getCategories()
    expect(cats[0].name).toBe('Apple')
    expect(cats[1].name).toBe('banana')
  })
})

// --- getCategoryById ---

describe('getCategoryById', () => {
  it('returns category by id', () => {
    const cat = createCategory('Tech')
    const found = getCategoryById(cat.id)
    expect(found).toBeDefined()
    expect(found!.name).toBe('Tech')
  })

  it('returns undefined for non-existent id', () => {
    expect(getCategoryById(9999)).toBeUndefined()
  })
})

// --- createCategory ---

describe('createCategory', () => {
  it('creates a category with auto-incremented sort_order', () => {
    const cat1 = createCategory('First')
    const cat2 = createCategory('Second')
    expect(cat1.sort_order).toBe(0)
    expect(cat2.sort_order).toBe(1)
  })

  it('returns created category with id', () => {
    const cat = createCategory('Test')
    expect(cat.id).toBeGreaterThan(0)
    expect(cat.name).toBe('Test')
  })
})

// --- updateCategory ---

describe('updateCategory', () => {
  it('updates name', () => {
    const cat = createCategory('Old')
    const updated = updateCategory(cat.id, { name: 'New' })
    expect(updated!.name).toBe('New')
  })

  it('updates sort_order', () => {
    const cat = createCategory('Test')
    const updated = updateCategory(cat.id, { sort_order: 42 })
    expect(updated!.sort_order).toBe(42)
  })

  it('updates collapsed', () => {
    const cat = createCategory('Test')
    const updated = updateCategory(cat.id, { collapsed: 1 })
    expect(updated!.collapsed).toBe(1)
  })

  it('updates multiple fields at once', () => {
    const cat = createCategory('Test')
    const updated = updateCategory(cat.id, { name: 'Renamed', sort_order: 10, collapsed: 1 })
    expect(updated!.name).toBe('Renamed')
    expect(updated!.sort_order).toBe(10)
    expect(updated!.collapsed).toBe(1)
  })

  it('returns unchanged category when no fields provided', () => {
    const cat = createCategory('Test')
    const updated = updateCategory(cat.id, {})
    expect(updated!.name).toBe('Test')
  })

  it('returns undefined for non-existent id', () => {
    expect(updateCategory(9999, { name: 'Nope' })).toBeUndefined()
  })
})

// --- deleteCategory ---

describe('deleteCategory', () => {
  it('deletes an existing category', () => {
    const cat = createCategory('ToDelete')
    expect(deleteCategory(cat.id)).toBe(true)
    expect(getCategoryById(cat.id)).toBeUndefined()
  })

  it('returns false for non-existent id', () => {
    expect(deleteCategory(9999)).toBe(false)
  })
})

describe('reorderCategories', () => {
  it('updates category sort_order in the provided order', () => {
    const first = createCategory('First')
    const second = createCategory('Second')

    reorderCategories([second.id, first.id])

    const categories = getCategories()
    expect(categories[0].id).toBe(second.id)
    expect(categories[1].id).toBe(first.id)
    expect(getCategoryById(second.id)!.sort_order).toBe(0)
    expect(getCategoryById(first.id)!.sort_order).toBe(1)
  })
})

// --- markAllSeenByCategory ---

describe('markAllSeenByCategory', () => {
  it('marks unseen articles in category as seen', () => {
    const cat = createCategory('Tech')
    const feed = createFeed({ name: 'Feed', url: 'https://example.com', category_id: cat.id })
    seedArticle(feed.id)
    seedArticle(feed.id)

    const result = markAllSeenByCategory(cat.id)
    expect(result.updated).toBe(2)
  })

  it('does not re-mark already seen articles', () => {
    const cat = createCategory('Tech')
    const feed = createFeed({ name: 'Feed', url: 'https://example.com', category_id: cat.id })
    seedArticle(feed.id)

    markAllSeenByCategory(cat.id)
    const result = markAllSeenByCategory(cat.id)
    expect(result.updated).toBe(0)
  })

  it('returns 0 when no articles in category', () => {
    const cat = createCategory('Empty')
    const result = markAllSeenByCategory(cat.id)
    expect(result.updated).toBe(0)
  })

  it('only marks articles in the specified category', () => {
    const cat1 = createCategory('Cat1')
    const cat2 = createCategory('Cat2')
    const feed1 = createFeed({ name: 'Feed1', url: 'https://a.com', category_id: cat1.id })
    const feed2 = createFeed({ name: 'Feed2', url: 'https://b.com', category_id: cat2.id })
    seedArticle(feed1.id)
    seedArticle(feed2.id)

    markAllSeenByCategory(cat1.id)

    // cat2 articles should still be unseen
    const { articles } = getArticles({ categoryId: cat2.id, unread: true, limit: 100, offset: 0 })
    expect(articles).toHaveLength(1)
  })
})
