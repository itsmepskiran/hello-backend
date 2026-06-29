import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { MiddlewareHandler } from 'hono'

// ── Env bindings ───────────────────────────────────────────────────────────────
interface Env {
  DB:                   D1Database
  SESSIONS:             KVNamespace
  IMAGES:               R2Bucket
  BASE_URL:             string
  RAZORPAY_KEY_ID:      string
  RAZORPAY_KEY_SECRET:  string
}

type AppEnv = { Bindings: Env }

// ── Hardcoded admin user ───────────────────────────────────────────────────────
const ADMIN_EMAIL    = 'admin@hellobmg.com'
const ADMIN_PASSWORD = 'HelloBMG@2025'

// ── App ────────────────────────────────────────────────────────────────────────
const app = new Hono<AppEnv>()

app.use('*', cors({
  origin:         (origin) => origin ?? '*',   // echo back requesting origin (required when Authorization header is present)
  allowMethods:   ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders:   ['Content-Type', 'Authorization'],
  exposeHeaders:  ['Content-Length'],
  maxAge:         86400,
}))

// ── Helpers ────────────────────────────────────────────────────────────────────
async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function ensureRef(db: D1Database, table: string, name: string): Promise<string> {
  const row = await db
    .prepare(`SELECT id FROM ${table} WHERE name = ? LIMIT 1`)
    .bind(name)
    .first<{ id: string }>()
  if (row) return row.id
  const id = crypto.randomUUID()
  await db.prepare(`INSERT INTO ${table} (id, name) VALUES (?, ?)`).bind(id, name).run()
  return id
}

// ── Auth middleware ────────────────────────────────────────────────────────────
const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = c.req.header('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return c.json({ detail: 'Not authenticated' }, 401)
  const token = auth.slice(7)
  const email = await c.env.SESSIONS.get(`token:${token}`)
  if (!email) return c.json({ detail: 'Invalid or expired session. Please sign in.' }, 401)
  await next()
}

// ── Health ─────────────────────────────────────────────────────────────────────
app.get('/health', (c) =>
  c.json({ status: 'ok', time: Math.floor(Date.now() / 1000) })
)

// ── Admin login / logout ───────────────────────────────────────────────────────
app.post('/admin/login', async (c) => {
  const { email, password } = await c.req.json<{ email: string; password: string }>()

  const [pwHash, expectedHash] = await Promise.all([
    sha256hex(password),
    sha256hex(ADMIN_PASSWORD),
  ])

  if (email.trim().toLowerCase() !== ADMIN_EMAIL || pwHash !== expectedHash) {
    return c.json({ detail: 'Invalid email or password' }, 401)
  }

  const token = crypto.randomUUID()
  await c.env.SESSIONS.put(`token:${token}`, ADMIN_EMAIL, { expirationTtl: 86400 })
  return c.json({ token, email: ADMIN_EMAIL })
})

app.post('/admin/logout', async (c) => {
  const auth = c.req.header('Authorization') ?? ''
  if (auth.startsWith('Bearer ')) {
    await c.env.SESSIONS.delete(`token:${auth.slice(7)}`)
  }
  return c.json({ status: 'logged out' })
})

// ── Products (public) ──────────────────────────────────────────────────────────
app.get('/products', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT
      p.id, p.title, p.price, p.mrp, p.rating, p.stock, p.popularity,
      p.specs, p.tags, p.stock_status,
      b.name   AS brand_name,
      cat.name AS category_name,
      pi.public_url AS image_url
    FROM products p
    LEFT JOIN brands b          ON b.id   = p.brand_id
    LEFT JOIN categories cat    ON cat.id  = p.category_id
    LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
    WHERE p.is_active = 1
    ORDER BY p.popularity DESC
    LIMIT 200
  `).all<Record<string, unknown>>()

  return c.json(results.map(row => {
    const specs = row.specs ? JSON.parse(row.specs as string) : {}
    const tags  = row.tags  ? JSON.parse(row.tags  as string) : []
    return {
      id:         row.id,
      title:      row.title,
      brand:      row.brand_name    ?? '',
      model:      specs.model       ?? '',
      category:   row.category_name ?? 'Other',
      price:      row.price,
      mrp:        row.mrp,
      rating:     row.rating        ?? 0,
      stock:      row.stock         ?? 0,
      popularity: row.popularity    ?? 0,
      image:      row.image_url,
      tags,
      specs,
    }
  }))
})

// ── Admin: Brands ──────────────────────────────────────────────────────────────
app.get('/admin/brands', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name FROM brands ORDER BY name'
  ).all()
  return c.json(results)
})

app.post('/admin/brands', requireAdmin, async (c) => {
  const { name } = await c.req.json<{ name: string }>()
  const id = crypto.randomUUID()
  try {
    await c.env.DB.prepare('INSERT INTO brands (id, name) VALUES (?, ?)')
      .bind(id, name.trim()).run()
    return c.json({ id, name: name.trim() }, 201)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : ''
    if (msg.includes('UNIQUE')) return c.json({ detail: 'Brand already exists' }, 400)
    throw e
  }
})

// ── Admin: Categories ──────────────────────────────────────────────────────────
app.get('/admin/categories', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name FROM categories ORDER BY name'
  ).all()
  return c.json(results)
})

app.post('/admin/categories', requireAdmin, async (c) => {
  const { name } = await c.req.json<{ name: string }>()
  const id = crypto.randomUUID()
  try {
    await c.env.DB.prepare('INSERT INTO categories (id, name) VALUES (?, ?)')
      .bind(id, name.trim()).run()
    return c.json({ id, name: name.trim() }, 201)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : ''
    if (msg.includes('UNIQUE')) return c.json({ detail: 'Category already exists' }, 400)
    throw e
  }
})

// ── Admin: Create product ──────────────────────────────────────────────────────
app.post('/admin/products', requireAdmin, async (c) => {
  const body = await c.req.json<{
    title: string; brand_id?: string; category_id?: string
    price: number; mrp?: number; rating?: number; stock?: number
    popularity?: number; specs?: object; tags?: string[]
    is_active?: boolean; stock_status?: string
  }>()

  const pid = crypto.randomUUID()
  await c.env.DB.prepare(`
    INSERT INTO products
      (id, title, brand_id, category_id, price, mrp, rating,
       stock, popularity, specs, tags, is_active, stock_status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    pid,
    body.title,
    body.brand_id    ?? null,
    body.category_id ?? null,
    body.price,
    body.mrp         ?? null,
    body.rating      ?? null,
    body.stock       ?? 0,
    body.popularity  ?? 0,
    JSON.stringify(body.specs ?? {}),
    JSON.stringify(body.tags  ?? []),
    body.is_active !== false ? 1 : 0,
    body.stock_status ?? 'in_stock',
  ).run()

  return c.json({ id: pid }, 201)
})

// ── Admin: Upload product image → R2 ──────────────────────────────────────────
app.post('/admin/products/:productId/images', requireAdmin, async (c) => {
  const productId = c.req.param('productId')
  const form      = await c.req.formData()
  const file      = form.get('file') as File | null
  const isPrimary = form.get('is_primary') !== 'false'

  if (!file) return c.json({ detail: 'No file provided' }, 400)

  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase()
  const key = `products/${productId}/${Date.now()}-primary.${ext}`

  await c.env.IMAGES.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || 'image/jpeg' },
  })

  const origin    = new URL(c.req.url).origin
  const publicUrl = `${origin}/images/${key}`
  const db        = c.env.DB

  if (isPrimary) {
    await db.prepare('UPDATE product_images SET is_primary=0 WHERE product_id=?')
      .bind(productId).run()
  }

  const imgId = crypto.randomUUID()
  await db.prepare(`
    INSERT INTO product_images (id, product_id, r2_key, public_url, is_primary, sort_order)
    VALUES (?,?,?,?,?,0)
  `).bind(imgId, productId, key, publicUrl, isPrimary ? 1 : 0).run()

  return c.json({ path: key, public_url: publicUrl }, 201)
})

// ── Serve R2 images ────────────────────────────────────────────────────────────
app.get('/images/*', async (c) => {
  const key = c.req.path.replace(/^\/images\//, '')
  if (!key) return c.json({ detail: 'Not found' }, 404)

  const obj = await c.env.IMAGES.get(key)
  if (!obj) return c.json({ detail: 'Image not found' }, 404)

  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('cache-control', 'public, max-age=31536000, immutable')
  headers.set('access-control-allow-origin', '*')
  return new Response(obj.body, { headers })
})

// ── Admin: Update stock ────────────────────────────────────────────────────────
app.patch('/admin/products/:productId/stock', requireAdmin, async (c) => {
  const productId = c.req.param('productId')
  const body      = await c.req.json<{
    stock: number; is_active?: boolean; stock_status?: string
  }>()

  const parts: string[] = ['stock=?']
  const vals:  unknown[] = [body.stock]

  if (body.is_active !== undefined) {
    parts.push('is_active=?')
    vals.push(body.is_active ? 1 : 0)
  }
  if (body.stock_status) {
    parts.push('stock_status=?')
    vals.push(body.stock_status)
  }
  vals.push(productId)

  await c.env.DB.prepare(`UPDATE products SET ${parts.join(', ')} WHERE id=?`)
    .bind(...vals).run()

  return c.json({ status: 'ok' })
})

// ── Admin: Stock overview (all products, incl. inactive) ──────────────────────
app.get('/admin/stock', requireAdmin, async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT
      p.id, p.title, p.price, p.mrp, p.stock, p.stock_status, p.is_active,
      b.name   AS brand_name,
      cat.name AS category_name
    FROM products p
    LEFT JOIN brands b      ON b.id   = p.brand_id
    LEFT JOIN categories cat ON cat.id = p.category_id
    ORDER BY p.title ASC
  `).all<Record<string, unknown>>()
  return c.json(results)
})

// ── Admin: Bulk JSON (XLSX parsed client-side, sent as JSON array) ─────────────
app.post('/admin/products/bulk-json', requireAdmin, async (c) => {
  const { products } = await c.req.json<{ products: Record<string, unknown>[] }>()

  if (!Array.isArray(products) || products.length === 0) {
    return c.json({ detail: 'No products provided' }, 400)
  }

  const db = c.env.DB
  let created = 0
  let updated = 0

  for (const row of products) {
    const title = String(row.title ?? '').trim()
    if (!title) continue

    const brandId = row.brand    ? await ensureRef(db, 'brands',     String(row.brand).trim())    : null
    const catId   = row.category ? await ensureRef(db, 'categories', String(row.category).trim()) : null
    const price   = Number(row.price)  || 0
    const mrp     = row.mrp    ? Number(row.mrp)    : null
    const rating  = row.rating ? Number(row.rating) : null
    const stock   = Number(row.stock)  || 0
    const tags    = row.tags
      ? String(row.tags).split(',').map((t: string) => t.trim()).filter(Boolean)
      : []
    const stockStatus = String(row.stock_status || (stock > 0 ? 'in_stock' : 'out_of_stock')).toLowerCase()

    const specs: Record<string, string> = {}
    if (row.specs_json) {
      try { Object.assign(specs, JSON.parse(String(row.specs_json))) } catch { /* ignore */ }
    }
    for (const k of ['storage', 'ram', 'display', 'battery', 'camera', 'warranty']) {
      if (row[k]) specs[k] = String(row[k])
    }

    const existing = await db
      .prepare('SELECT id FROM products WHERE title=? LIMIT 1')
      .bind(title)
      .first<{ id: string }>()

    if (existing) {
      await db.prepare(`
        UPDATE products
        SET brand_id=?, category_id=?, price=?, mrp=?, rating=?,
            stock=?, specs=?, tags=?, is_active=1, stock_status=?
        WHERE id=?
      `).bind(
        brandId, catId, price, mrp, rating, stock,
        JSON.stringify(specs), JSON.stringify(tags), stockStatus,
        existing.id,
      ).run()
      updated++
    } else {
      await db.prepare(`
        INSERT INTO products
          (id, title, brand_id, category_id, price, mrp, rating,
           stock, popularity, specs, tags, is_active, stock_status)
        VALUES (?,?,?,?,?,?,?,?,0,?,?,1,?)
      `).bind(
        crypto.randomUUID(), title, brandId, catId,
        price, mrp, rating, stock,
        JSON.stringify(specs), JSON.stringify(tags), stockStatus,
      ).run()
      created++
    }
  }

  return c.json({ created, updated })
})

// ── Razorpay ───────────────────────────────────────────────────────────────────
app.post('/payments/create-order', async (c) => {
  if (!c.env.RAZORPAY_KEY_ID || !c.env.RAZORPAY_KEY_SECRET) {
    return c.json({ detail: 'Razorpay not configured' }, 500)
  }

  const { amount, currency = 'INR', notes = {} } =
    await c.req.json<{ amount: number; currency?: string; notes?: object }>()

  if (amount < 100) return c.json({ detail: 'Amount must be at least ₹1 (100 paise)' }, 400)

  const auth = btoa(`${c.env.RAZORPAY_KEY_ID}:${c.env.RAZORPAY_KEY_SECRET}`)
  const res  = await fetch('https://api.razorpay.com/v1/orders', {
    method:  'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ amount, currency, payment_capture: 1, notes }),
  })

  if (!res.ok) return c.json({ detail: 'Order creation failed' }, 500)
  return c.json({ key_id: c.env.RAZORPAY_KEY_ID, order: await res.json() })
})

app.post('/payments/verify', async (c) => {
  if (!c.env.RAZORPAY_KEY_SECRET) {
    return c.json({ detail: 'Razorpay not configured' }, 500)
  }

  const { razorpay_payment_id, razorpay_order_id, razorpay_signature } =
    await c.req.json<{
      razorpay_payment_id: string
      razorpay_order_id:   string
      razorpay_signature:  string
    }>()

  const body = `${razorpay_order_id}|${razorpay_payment_id}`
  const key  = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(c.env.RAZORPAY_KEY_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBuf   = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  const generated = Array.from(new Uint8Array(sigBuf))
    .map(b => b.toString(16).padStart(2, '0')).join('')

  if (generated !== razorpay_signature) {
    return c.json({ detail: 'Invalid signature' }, 400)
  }
  return c.json({ status: 'verified' })
})

// ── Global error handler ───────────────────────────────────────────────────────
app.onError((err, c) => {
  console.error(err)
  return c.json({ detail: err.message || 'Internal server error' }, 500)
})

export default app
