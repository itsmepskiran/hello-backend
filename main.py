import os
import time
import hmac
import hashlib
from typing import Optional
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import razorpay
from supabase import create_client, Client
from io import BytesIO
from openpyxl import load_workbook
import requests

load_dotenv()

RAZORPAY_KEY_ID = os.getenv('RAZORPAY_KEY_ID')
RAZORPAY_KEY_SECRET = os.getenv('RAZORPAY_KEY_SECRET')
ALLOWED_ORIGINS = os.getenv('ALLOWED_ORIGINS','http://localhost:8000').split(',')

app = FastAPI(title='HelloBMG Backend', version='1.0.0')

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in ALLOWED_ORIGINS],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if not (RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET):
    print('Warning: Razorpay keys are not set. /payments endpoints will fail until provided.')

client: Optional[razorpay.Client] = None
if RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET:
    client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))

class CreateOrderRequest(BaseModel):
    amount: int  # in paise
    currency: str = 'INR'
    notes: Optional[dict] = None

class CreateOrderResponse(BaseModel):
    key_id: str
    order: dict

class VerifyRequest(BaseModel):
    razorpay_payment_id: str
    razorpay_order_id: str
    razorpay_signature: str

@app.get('/health')
async def health():
    return {'status':'ok','time': int(time.time())}

@app.post('/payments/create-order', response_model=CreateOrderResponse)
async def create_order(payload: CreateOrderRequest):
    if client is None:
        raise HTTPException(status_code=500, detail='Razorpay not configured')
    if payload.amount < 100:
        raise HTTPException(status_code=400, detail='Amount must be at least 100 paise (₹1)')
    try:
        order = client.order.create({
            'amount': payload.amount,
            'currency': payload.currency or 'INR',
            'payment_capture': 1,
            'notes': payload.notes or {},
        })
        return CreateOrderResponse(key_id=RAZORPAY_KEY_ID, order=order)
    except Exception as e:
        raise HTTPException(status_code=500, detail='Order creation failed') from e

@app.post('/payments/verify')
async def verify_signature(payload: VerifyRequest):
    if client is None:
        raise HTTPException(status_code=500, detail='Razorpay not configured')
    try:
        body = payload.razorpay_order_id + '|' + payload.razorpay_payment_id
        generated = hmac.new(bytes(RAZORPAY_KEY_SECRET, 'utf-8'), bytes(body, 'utf-8'), hashlib.sha256).hexdigest()
        if generated != payload.razorpay_signature:
            raise HTTPException(status_code=400, detail='Invalid signature')
        return {'status':'verified'}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail='Verification failed') from e

# Run: uvicorn backend.main:app --host 0.0.0.0 --port 8010

# ---------- Supabase (Admin API) ----------
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_SERVICE_ROLE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

sb: Optional[Client] = None
if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
else:
    print('Note: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set. Admin endpoints will fail until configured.')

class BrandCreate(BaseModel):
    name: str

class CategoryCreate(BaseModel):
    name: str

class ProductCreate(BaseModel):
    title: str
    brand_id: Optional[str]
    category_id: Optional[str]
    price: int
    mrp: Optional[int] = None
    rating: Optional[float] = None
    stock: Optional[int] = 0
    popularity: Optional[int] = 0
    specs: Optional[dict] = None
    tags: Optional[list] = None
    is_active: bool = True
    stock_status: Optional[str] = 'in_stock'

@app.get('/admin/brands')
async def list_brands():
    if sb is None: raise HTTPException(status_code=500, detail='Supabase not configured')
    res = sb.table('brands').select('id,name').order('name', desc=False).execute()
    if res.error: raise HTTPException(status_code=500, detail=str(res.error))
    return res.data

@app.post('/admin/brands')
async def create_brand(payload: BrandCreate):
    if sb is None: raise HTTPException(status_code=500, detail='Supabase not configured')
    res = sb.table('brands').insert({'name': payload.name}).select('id,name').execute()
    if res.error: raise HTTPException(status_code=400, detail=str(res.error))
    return res.data[0]

@app.get('/admin/categories')
async def list_categories():
    if sb is None: raise HTTPException(status_code=500, detail='Supabase not configured')
    res = sb.table('categories').select('id,name').order('name', desc=False).execute()
    if res.error: raise HTTPException(status_code=500, detail=str(res.error))
    return res.data

@app.post('/admin/categories')
async def create_category(payload: CategoryCreate):
    if sb is None: raise HTTPException(status_code=500, detail='Supabase not configured')
    res = sb.table('categories').insert({'name': payload.name}).select('id,name').execute()
    if res.error: raise HTTPException(status_code=400, detail=str(res.error))
    return res.data[0]

@app.post('/admin/products')
async def create_product(payload: ProductCreate):
    if sb is None: raise HTTPException(status_code=500, detail='Supabase not configured')
    data = payload.model_dump()
    res = sb.table('products').insert(data).select('id').execute()
    if res.error: raise HTTPException(status_code=400, detail=str(res.error))
    return {'id': res.data[0]['id']}

@app.post('/admin/products/{product_id}/images')
async def upload_product_image(product_id: str, file: UploadFile = File(...), is_primary: bool = Form(True)):
    if sb is None: raise HTTPException(status_code=500, detail='Supabase not configured')
    try:
        # Read file bytes
        content = await file.read()
        ext = (file.filename or 'image').split('.')[-1]
        path = f"{product_id}/{int(time.time())}-primary.{ext}"
        up = sb.storage.from_('product-images').upload(path, content, {
            'contentType': file.content_type or 'application/octet-stream',
            'upsert': False,
        })
        if up.get('error'):
            raise Exception(str(up['error']))
        pub = sb.storage.from_('product-images').get_public_url(path)
        public_url = pub.get('data', {}).get('publicUrl')
        ins = sb.table('product_images').insert({
            'product_id': product_id,
            'storage_path': path,
            'cdn_url': public_url,
            'is_primary': bool(is_primary),
            'sort_order': 0,
        }).execute()
        if ins.error:
            raise Exception(str(ins.error))
        return {'path': path, 'public_url': public_url}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f'Image upload failed: {e}')

class StockUpdate(BaseModel):
    stock: int
    is_active: Optional[bool] = None
    stock_status: Optional[str] = None

def _ensure_ref(table: str, name: str):
    """Ensure reference row exists and return its id."""
    sel = sb.table(table).select('id').eq('name', name).limit(1).execute()
    if sel.error:
        raise HTTPException(status_code=400, detail=str(sel.error))
    if sel.data:
        return sel.data[0]['id']
    ins = sb.table(table).insert({'name': name}).select('id').execute()
    if ins.error:
        raise HTTPException(status_code=400, detail=str(ins.error))
    return ins.data[0]['id']

@app.patch('/admin/products/{product_id}/stock')
async def update_stock(product_id: str, payload: StockUpdate):
    if sb is None: raise HTTPException(status_code=500, detail='Supabase not configured')
    update_data = {'stock': payload.stock}
    if payload.is_active is not None:
        update_data['is_active'] = payload.is_active
    if payload.stock_status is not None:
        update_data['stock_status'] = payload.stock_status
    res = sb.table('products').update(update_data).eq('id', product_id).execute()
    if res.error:
        raise HTTPException(status_code=400, detail=str(res.error))
    return {'status': 'ok'}

@app.post('/admin/products/bulk-xlsx')
async def bulk_upload_xlsx(file: UploadFile = File(...)):
    if sb is None: raise HTTPException(status_code=500, detail='Supabase not configured')
    try:
        content = await file.read()
        wb = load_workbook(BytesIO(content))
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            raise HTTPException(status_code=400, detail='Empty XLSX file')
        header = [str(h).strip().lower() if h is not None else '' for h in rows[0]]
        def col(name):
            try:
                return header.index(name)
            except ValueError:
                return -1
        idx = {
            'title': col('title'),
            'brand': col('brand'),
            'category': col('category'),
            'price': col('price'),
            'mrp': col('mrp'),
            'rating': col('rating'),
            'stock': col('stock'),
            'tags': col('tags'),
            'image_url': col('image_url'),
            'specs_json': col('specs_json'),
            'storage': col('storage'),
            'ram': col('ram'),
            'display': col('display'),
            'battery': col('battery'),
            'camera': col('camera'),
            'warranty': col('warranty'),
            'stock_status': col('stock_status'),
        }
        required_cols = ['title','brand','category','price']
        for rc in required_cols:
            if idx[rc] == -1:
                raise HTTPException(status_code=400, detail=f'Missing required column: {rc}')

        created = 0
        updated = 0
        images_uploaded = 0
        for r in rows[1:]:
            if r is None: continue
            title = (r[idx['title']] or '').strip() if idx['title']>=0 and r[idx['title']] else ''
            if not title:
                continue
            brand_name = (r[idx['brand']] or '').strip() if idx['brand']>=0 and r[idx['brand']] else ''
            category_name = (r[idx['category']] or '').strip() if idx['category']>=0 and r[idx['category']] else ''
            price = int(r[idx['price']] or 0) if idx['price']>=0 else 0
            mrp = int(r[idx['mrp']]) if idx['mrp']>=0 and r[idx['mrp']] is not None else None
            rating = float(r[idx['rating']]) if idx['rating']>=0 and r[idx['rating']] is not None else None
            stock = int(r[idx['stock']] or 0) if idx['stock']>=0 else 0
            tags_raw = (r[idx['tags']] or '') if idx['tags']>=0 and r[idx['tags']] is not None else ''
            tags = [t.strip() for t in str(tags_raw).split(',') if str(t).strip()]
            stock_status = (str(r[idx['stock_status']]).strip().lower() if idx['stock_status']>=0 and r[idx['stock_status']] is not None else ('in_stock' if stock>0 else 'out_of_stock'))

            specs = {}
            if idx['specs_json']>=0 and r[idx['specs_json']]:
                try:
                    import json
                    specs = json.loads(r[idx['specs_json']])
                except Exception:
                    specs = {}
            # merge manual specs columns if present
            for key in ['storage','ram','display','battery','camera','warranty']:
                if idx[key] >= 0 and r[idx[key]]:
                    specs[key] = str(r[idx[key]])

            brand_id = _ensure_ref('brands', brand_name) if brand_name else None
            category_id = _ensure_ref('categories', category_name) if category_name else None

            # Upsert by title if needed (simple heuristic)
            existing = sb.table('products').select('id').eq('title', title).limit(1).execute()
            if existing.error:
                raise HTTPException(status_code=400, detail=str(existing.error))

            payload = {
                'title': title,
                'brand_id': brand_id,
                'category_id': category_id,
                'price': price,
                'mrp': mrp,
                'rating': rating,
                'stock': stock,
                'popularity': 0,
                'specs': specs,
                'tags': tags,
                'is_active': True,
                'stock_status': stock_status,
            }

            if existing.data:
                prod_id = existing.data[0]['id']
                up = sb.table('products').update(payload).eq('id', prod_id).select('id').execute()
                if up.error:
                    raise HTTPException(status_code=400, detail=str(up.error))
                updated += 1
            else:
                ins = sb.table('products').insert(payload).select('id').execute()
                if ins.error:
                    raise HTTPException(status_code=400, detail=str(ins.error))
                prod_id = ins.data[0]['id']
                created += 1

            # Image handling
            if idx['image_url']>=0 and r[idx['image_url']]:
                try:
                    image_url = str(r[idx['image_url']]).strip()
                    resp = requests.get(image_url, timeout=15)
                    if resp.status_code == 200:
                        ext = 'jpg'
                        ct = resp.headers.get('content-type','')
                        if 'png' in ct: ext = 'png'
                        path = f"{prod_id}/{int(time.time())}-primary.{ext}"
                        up = sb.storage.from_('product-images').upload(path, resp.content, {
                            'contentType': ct or 'application/octet-stream',
                            'upsert': False,
                        })
                        if up.get('error'):
                            raise Exception(str(up['error']))
                        pub = sb.storage.from_('product-images').get_public_url(path)
                        public_url = pub.get('data', {}).get('publicUrl')
                        insi = sb.table('product_images').insert({
                            'product_id': prod_id,
                            'storage_path': path,
                            'cdn_url': public_url,
                            'is_primary': True,
                            'sort_order': 0,
                        }).execute()
                        if insi.error:
                            raise Exception(str(insi.error))
                        images_uploaded += 1
                except Exception:
                    pass

        return {'created': created, 'updated': updated, 'images_uploaded': images_uploaded}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f'Bulk upload failed: {e}')
