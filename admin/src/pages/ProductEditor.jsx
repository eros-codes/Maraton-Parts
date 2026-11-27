import { useEffect, useMemo, useState, useRef } from 'react';
import { Film, ImageOff, Trash2, Upload } from 'lucide-react';
import { api, request, upload } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { translateError } from '../lib/errorMessages';
import { digitsOnly, imageAt, imageUrl } from '../lib/format';
import { Button, Field, Modal } from '../components/Primitives';
import { useFieldErrors } from '../lib/useFieldErrors';

const EMPTY = {
  title: '',
  description: '',
  price: '',
  sale_price: '',
  stock: '0',
  weight_grams: '',
  brandId: '',
  categoryIds: [],
  is_published: true,
};

const TABS = ['general', 'specs', 'images'];

// The same limits the API enforces, checked here first so a clip that is
// too long is turned away at once rather than after a 50 MB upload.
const MAX_VIDEO_SECONDS = 30;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// The API takes at most this many pictures in one request.
const IMAGES_PER_REQUEST = 10;

// The clip's length as the browser reads it, or null when it cannot (an
// encoding it does not play - the API then decides, and says why).
function readVideoSeconds(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const probe = document.createElement('video');
    const done = (value) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    probe.preload = 'metadata';
    probe.onloadedmetadata = () =>
      done(Number.isFinite(probe.duration) ? probe.duration : null);
    probe.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
    probe.src = url;
  });
}

const videoOf = (product) =>
  product?.video_url
    ? {
        url: product.video_url,
        durationMs: product.video_duration_ms,
        sizeBytes: product.video_size_bytes,
      }
    : null;

const seconds = (ms) => (Math.round(ms / 100) / 10).toLocaleString('fa-IR');
const megabytes = (bytes) => (Math.round(bytes / 104857.6) / 10).toLocaleString('fa-IR');

export default function ProductEditor({ mode, productId, initialTab, onClose, onSaved }) {
  const toast = useToast();
  const fieldErrors = useFieldErrors();
  const isEdit = mode === 'edit';

  const [form, setForm] = useState(EMPTY);
  const [productAttributes, setProductAttributes] = useState({});
  // Attributes the chosen categories mark as required: the specs tab flags
  // them, and the API refuses the product without them.
  const [requiredIds, setRequiredIds] = useState(new Set());
  const [brands, setBrands] = useState([]);
  const [categories, setCategories] = useState([]);
  const [attributes, setAttributes] = useState([]);
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  // setSaving only disables the button on the next render, so clicks landing
  // in the same React tick all get through. This ref closes that window - it
  // matters because a repeated submit fires side effects again and can leave
  // duplicate rows wherever the database has no unique constraint.
  const busyRef = useRef(false);
  const [tab, setTab] = useState(TABS.includes(initialTab) ? initialTab : 'general');
  const [uploading, setUploading] = useState(false);
  const [video, setVideo] = useState(null);
  // 0..1 while a video is on its way up, null otherwise.
  const [videoProgress, setVideoProgress] = useState(null);
  const [priceError, setPriceError] = useState(null);
  // A new product has no id to upload to yet, so the pictures and the video
  // picked for it wait here, shown from the browser's own copy, and go up
  // right after the product is created.
  const [pendingImages, setPendingImages] = useState([]);
  const [pendingVideo, setPendingVideo] = useState(null);
  // What the save button is doing once the product itself is saved.
  const [saveStage, setSaveStage] = useState(null);

  // The local previews hold memory until they are let go.
  const previewUrls = useRef(new Set());
  const preview = (file) => {
    const url = URL.createObjectURL(file);
    previewUrls.current.add(url);
    return url;
  };
  const release = (url) => {
    URL.revokeObjectURL(url);
    previewUrls.current.delete(url);
  };
  useEffect(() => {
    const urls = previewUrls.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    Promise.allSettled([
      api.get('/brands'),
      api.get('/categories'),
      api.get('/attributes'),
    ]).then(([brandsResult, categoriesResult, attributesResult]) => {
      if (brandsResult.status === 'fulfilled') {
        setBrands(brandsResult.value?.items ?? brandsResult.value ?? []);
      }
      if (categoriesResult.status === 'fulfilled') {
        setCategories(
          categoriesResult.value?.items ?? categoriesResult.value ?? [],
        );
      }
      if (attributesResult.status === 'fulfilled') {
        setAttributes(attributesResult.value ?? []);
      }
    });
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    setLoading(true);
    api
      .get(`/products/${productId}?includeDrafts=true`, { auth: true })
      .then((product) => {
        setForm({
          title: product.title ?? '',
          description: product.description ?? '',
          price: product.price ?? '',
          sale_price: product.sale_price ?? '',
          stock: String(product.stock ?? 0),
          weight_grams: product.weight_grams ?? '',
          brandId: product.brand?.id ?? '',
          categoryIds: (product.categories ?? []).map((category) => category.id),
          is_published: product.is_published ?? true,
        });
        setImages(product.images ?? []);
        setVideo(videoOf(product));
        loadedStock.current = Number(product.stock) || 0;
        setProductAttributes(
          Object.fromEntries(
            (product.attributeValues ?? []).map((value) => [
              value.attribute.id,
              value.option?.id ??
                value.value_text ??
                value.value_number ??
                value.value_boolean,
            ]),
          ),
        );
      })
      .catch(() => toast.error('این کالا بارگذاری نشد'))
      .finally(() => setLoading(false));
  }, [isEdit, productId, toast]);

  // Which attributes the product's categories require. Read again whenever
  // the category choice changes.
  const categoryKey = form.categoryIds.join(',');
  useEffect(() => {
    const ids = categoryKey ? categoryKey.split(',') : [];
    if (ids.length === 0) {
      setRequiredIds(new Set());
      return;
    }
    let cancelled = false;
    Promise.all(
      ids.map((id) => api.get(`/categories/${id}/attributes`).catch(() => [])),
    ).then((lists) => {
      if (cancelled) return;
      setRequiredIds(
        new Set(
          lists
            .flat()
            .filter((link) => link?.is_required)
            .map((link) => link.attribute?.id),
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [categoryKey]);

  // Required ones first, so they are not lost at the bottom of a long list.
  const orderedAttributes = useMemo(
    () =>
      [...attributes].sort(
        (a, b) => Number(requiredIds.has(b.id)) - Number(requiredIds.has(a.id)),
      ),
    [attributes, requiredIds],
  );

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  // The stock as it was when the editor opened. Saving used to write back
  // the number the form had loaded, so a sale made while the editor was
  // open was silently undone - even when the admin had only touched the
  // description. Stock now goes out only when it was changed here, with
  // the value it was changed from, and the API refuses it if units were
  // sold in the meantime.
  const loadedStock = useRef(0);

  const descriptivePayload = () =>
    Object.entries(productAttributes)
      .filter(([, value]) => value !== '' && value !== undefined && value !== null)
      .map(([attributeId, value]) => {
        const attribute = attributes.find(
          (item) => String(item.id) === String(attributeId),
        );
        if (!attribute) return null;
        if (attribute.type === 'select' || attribute.type === 'color') {
          return { attributeId: Number(attributeId), optionId: Number(value) };
        }
        if (attribute.type === 'number') {
          return { attributeId: Number(attributeId), value_number: Number(value) };
        }
        if (attribute.type === 'boolean') {
          return {
            attributeId: Number(attributeId),
            value_boolean: value === true || value === 'true',
          };
        }
        return { attributeId: Number(attributeId), value_text: String(value) };
      })
      .filter(Boolean);

  const save = async () => {
    if (busyRef.current) return;
    // An empty price used to go out as 0 - a product published for free.
    if (form.price === '') {
      setPriceError('قیمت کالا را وارد کنید.');
      setTab('general');
      return;
    }
    setPriceError(null);
    const stock = Number(form.stock) || 0;
    busyRef.current = true;
    setSaving(true);
    try {
      const base = {
        title: form.title.trim(),
        description: form.description.trim(),
        price: Number(form.price) || 0,
        // When editing, an emptied field is sent as null so it is actually
        // cleared - leaving it out kept the old sale running and the old
        // brand attached, whatever the form showed.
        ...(form.sale_price !== ''
          ? { sale_price: Number(form.sale_price) }
          : isEdit
            ? { sale_price: null }
            : {}),
        ...(form.weight_grams !== ''
          ? { weight_grams: Number(form.weight_grams) }
          : {}),
        ...(form.brandId
          ? { brandId: Number(form.brandId) }
          : isEdit
            ? { brandId: null }
            : {}),
        ...(form.categoryIds.length ? { categoryIds: form.categoryIds } : {}),
        is_published: form.is_published,
        attributes: descriptivePayload(),
      };

      fieldErrors.clear();
      if (isEdit) {
        const stockChanged = stock !== loadedStock.current;
        await api.patch(
          `/products/${productId}`,
          {
            ...base,
            ...(stockChanged ? { stock, expected_stock: loadedStock.current } : {}),
          },
          { auth: true },
        );
        loadedStock.current = stock;
        toast.success('کالا به‌روز شد');
        onSaved();
      } else {
        const created = await api.post('/products', { ...base, stock }, { auth: true });
        const createdId = created?.id ?? null;
        if (!createdId || (pendingImages.length === 0 && !pendingVideo)) {
          // Nothing picked yet: the editor carries on to the pictures of
          // the product it has just made.
          toast.success('کالا ساخته شد؛ حالا تصاویرش را اضافه کنید');
          onSaved(createdId);
          return;
        }
        const failed = await uploadPending(createdId);
        if (failed) {
          // The product is saved; only some media did not make it. The
          // editor reopens on its media, where the upload can be retried.
          toast.error(`کالا ساخته شد، ولی ${failed}`);
          onSaved(createdId);
        } else {
          toast.success('کالا همراه با تصاویر و ویدیو ساخته شد');
          onSaved();
        }
      }
    } catch (error) {
      if (
        fieldErrors.capture(error, [
          'title',
          'description',
          'price',
          'sale_price',
          'stock',
          'weight_grams',
          'brandId',
          'categoryIds',
        ])
      ) {
        // Every one of these fields is on the first tab; the admin may be
        // on the media tab when the save comes back with them.
        setTab('general');
        toast.error('چند مورد از فرم نیاز به اصلاح دارد.');
      } else {
        toast.error(translateError(error));
      }
    } finally {
      busyRef.current = false;
      setSaving(false);
      setSaveStage(null);
    }
  };

  // Uploads what was picked for a new product. Returns null when it all
  // went up, otherwise what failed, worded for the toast.
  const uploadPending = async (id) => {
    const problems = [];
    for (let start = 0; start < pendingImages.length; start += IMAGES_PER_REQUEST) {
      const batch = pendingImages.slice(start, start + IMAGES_PER_REQUEST);
      setSaveStage(
        `آپلود تصاویر ${Math.min(start + batch.length, pendingImages.length).toLocaleString('fa-IR')} از ${pendingImages.length.toLocaleString('fa-IR')}…`,
      );
      const body = new FormData();
      batch.forEach((item) => body.append('images', item.file));
      try {
        await request(`/products/${id}/images`, { method: 'POST', body, auth: true });
      } catch (error) {
        problems.push(`آپلود تصاویر انجام نشد (${translateError(error)})`);
        break;
      }
    }
    if (pendingVideo) {
      setSaveStage('آپلود ویدیو…');
      const body = new FormData();
      body.append('video', pendingVideo.file);
      setVideoProgress(0);
      try {
        await upload(`/products/${id}/video`, body, { onProgress: setVideoProgress });
      } catch (error) {
        problems.push(
          error?.code === 'FILE_TOO_LARGE'
            ? 'ویدیو بیشتر از ۵۰ مگابایت بود'
            : `ویدیو آپلود نشد (${translateError(error)})`,
        );
      } finally {
        setVideoProgress(null);
      }
    }
    return problems.length ? problems.join(' و ') : null;
  };

  // Picked for a new product: checked now, uploaded on save.
  const queueImages = (event) => {
    const input = event.target;
    const files = [...(input.files ?? [])];
    input.value = '';
    const tooBig = files.filter((file) => file.size > MAX_IMAGE_BYTES);
    if (tooBig.length) {
      toast.error(`${tooBig.length.toLocaleString('fa-IR')} تصویر بیشتر از ۵ مگابایت است و اضافه نشد.`);
    }
    const accepted = files.filter((file) => file.size <= MAX_IMAGE_BYTES);
    setPendingImages((current) => [
      ...current,
      ...accepted.map((file) => ({ key: `${file.name}-${file.size}-${Math.random()}`, file, url: preview(file) })),
    ]);
  };

  const dropPendingImage = (key) =>
    setPendingImages((current) => {
      const gone = current.find((item) => item.key === key);
      if (gone) release(gone.url);
      return current.filter((item) => item.key !== key);
    });

  const coverPendingImage = (key) =>
    setPendingImages((current) => [
      ...current.filter((item) => item.key === key),
      ...current.filter((item) => item.key !== key),
    ]);

  // The same checks as an upload, before the clip is held for saving.
  const checkVideo = async (file) => {
    if (file.size > MAX_VIDEO_BYTES) {
      toast.error(`حجم ویدیو ${megabytes(file.size)} مگابایت است؛ حداکثر ۵۰ مگابایت مجاز است.`);
      return null;
    }
    const length = await readVideoSeconds(file);
    if (length !== null && length > MAX_VIDEO_SECONDS + 0.5) {
      toast.error(
        `این ویدیو ${Math.round(length).toLocaleString('fa-IR')} ثانیه است؛ حداکثر ۳۰ ثانیه مجاز است.`,
      );
      return null;
    }
    return { length };
  };

  const queueVideo = async (event) => {
    const input = event.target;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const checked = await checkVideo(file);
    if (!checked) return;
    setPendingVideo((current) => {
      if (current) release(current.url);
      return {
        file,
        url: preview(file),
        durationMs: checked.length !== null ? checked.length * 1000 : null,
        sizeBytes: file.size,
      };
    });
  };

  const dropPendingVideo = () =>
    setPendingVideo((current) => {
      if (current) release(current.url);
      return null;
    });

  const uploadImages = async (event) => {
    const input = event.target;
    const files = [...(input.files ?? [])];
    // Cleared at once, so picking the same file again (after a failed
    // upload, say) still fires a change.
    input.value = '';
    if (files.length === 0 || !isEdit) return;
    const body = new FormData();
    files.forEach((file) => body.append('images', file));
    setUploading(true);
    try {
      const updated = await request(`/products/${productId}/images`, {
        method: 'POST',
        body,
        auth: true,
      });
      setImages(updated?.images ?? []);
      toast.success('تصاویر آپلود شد');
    } catch (error) {
      toast.error(translateError(error));
    } finally {
      setUploading(false);
    }
  };

  const uploadVideo = async (event) => {
    const input = event.target;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !isEdit) return;
    if (!(await checkVideo(file))) return;

    const body = new FormData();
    body.append('video', file);
    setVideoProgress(0);
    try {
      const updated = await upload(`/products/${productId}/video`, body, {
        onProgress: setVideoProgress,
      });
      setVideo(videoOf(updated));
      toast.success('ویدیو آپلود شد');
    } catch (error) {
      toast.error(
        error?.code === 'FILE_TOO_LARGE'
          ? 'حجم ویدیو بیشتر از ۵۰ مگابایت است.'
          : translateError(error),
      );
    } finally {
      setVideoProgress(null);
    }
  };

  const removeVideo = async () => {
    try {
      await api.delete(`/products/${productId}/video`, undefined, { auth: true });
      setVideo(null);
      toast.success('ویدیو حذف شد');
    } catch (error) {
      toast.error(translateError(error));
    }
  };

  const makeCover = async (imageId) => {
    try {
      const updated = await api.patch(
        `/products/${productId}/images/${imageId}/cover`,
        {},
        { auth: true },
      );
      setImages(updated?.images ?? []);
      toast.success('تصویر اصلی تغییر کرد');
    } catch (error) {
      toast.error(translateError(error));
    }
  };

  const removeImage = async (imageId) => {
    try {
      await api.delete(`/products/${productId}/images/${imageId}`, undefined, {
        auth: true,
      });
      setImages((current) => current.filter((image) => image.id !== imageId));
      toast.success('تصویر حذف شد');
    } catch (error) {
      toast.error(translateError(error));
    }
  };

  // One list and one clip to draw, whether they are already on the
  // product (editing) or still waiting in the browser (a new product).
  const shownImages = isEdit
    ? images.map((image) => ({ key: image.id, src: imageAt(image, 200) }))
    : pendingImages.map((item) => ({ key: item.key, src: item.url }));
  const shownVideo = isEdit
    ? video && { ...video, src: imageUrl(video.url) }
    : pendingVideo && { ...pendingVideo, src: pendingVideo.url };

  return (
    <Modal
      wide
      title={isEdit ? 'ویرایش کالا' : 'کالای جدید'}
      onClose={onClose}
      footer={
        <>
          {saveStage ? (
            <span className="tiny muted" aria-live="polite" style={{ marginInlineEnd: 'auto' }}>
              {saveStage}
            </span>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            انصراف
          </Button>
          <Button onClick={save} loading={saving} disabled={loading}>
            ذخیره
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="skeleton" style={{ height: 280 }} />
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="row" style={{ gap: 6, borderBottom: '1px solid var(--line)' }}>
            {[
              ['general', 'اطلاعات کلی'],
              ['specs', 'مشخصات'],
              ['images', 'تصاویر و ویدیو'],
            ].map(([value, label]) => (
              <button
                key={value}
                className="btn btn-ghost btn-sm"
                style={{
                  border: 'none',
                  borderBottom:
                    tab === value ? '2px solid var(--brand-600)' : '2px solid transparent',
                  borderRadius: 0,
                  color: tab === value ? 'var(--brand-700)' : 'var(--ink-500)',
                }}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'general' ? (
            <div className="stack">
              <Field label="عنوان کالا"
            error={fieldErrors.of('title')}>
                <input
                  className="input"
                  value={form.title}
                  onChange={(event) => set('title', event.target.value)}
                />
              </Field>

              <Field label="توضیحات"
            error={fieldErrors.of('description')}>
                <textarea
                  className="textarea"
                  value={form.description}
                  onChange={(event) => set('description', event.target.value)}
                />
              </Field>

              <div className="grid cols-4">
                <Field label="قیمت (تومان)"
            error={priceError ?? fieldErrors.of('price')}>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={form.price}
                    onChange={(event) => {
                      setPriceError(null);
                      set('price', digitsOnly(event.target.value));
                    }}
                  />
                </Field>
                <Field
                  label="قیمت حراج"
                  error={fieldErrors.of('sale_price')}
                  hint="خالی یعنی بدون حراج."
                >
                  <input
                    className="input"
                    inputMode="numeric"
                    value={form.sale_price}
                    onChange={(event) => set('sale_price', digitsOnly(event.target.value))}
                  />
                </Field>
                <Field
                  label="موجودی"
                  error={fieldErrors.of('stock')}
                  hint={isEdit ? 'فروش‌های هم‌زمان را پاک نمی‌کند' : undefined}
                >
                  <input
                    className="input"
                    inputMode="numeric"
                    value={form.stock}
                    onChange={(event) => set('stock', digitsOnly(event.target.value))}
                  />
                </Field>
                <Field label="وزن (گرم)"
            error={fieldErrors.of('weight_grams')} hint="برای محاسبه هزینه ارسال">
                  <input
                    className="input"
                    inputMode="numeric"
                    value={form.weight_grams}
                    onChange={(event) => set('weight_grams', digitsOnly(event.target.value))}
                  />
                </Field>
              </div>

              <div className="grid cols-2">
                <Field label="برند"
            error={fieldErrors.of('brandId')}>
                  <select
                    className="select"
                    value={form.brandId}
                    onChange={(event) => set('brandId', event.target.value)}
                  >
                    <option value="">بدون برند</option>
                    {brands.map((brand) => (
                      <option key={brand.id} value={brand.id}>
                        {brand.title}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="دسته‌بندی‌ها"
            error={fieldErrors.of('categoryIds')} hint="می‌توانید چند مورد انتخاب کنید">
                  <select
                    className="select"
                    multiple
                    style={{ minHeight: 92 }}
                    value={form.categoryIds.map(String)}
                    onChange={(event) =>
                      set(
                        'categoryIds',
                        [...event.target.selectedOptions].map((option) =>
                          Number(option.value),
                        ),
                      )
                    }
                  >
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.title}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={form.is_published}
                  onChange={(event) => set('is_published', event.target.checked)}
                />
                در فروشگاه نمایش داده شود
              </label>
            </div>
          ) : null}

          {tab === 'specs' ? (
            <div className="stack">
              <p className="tiny muted">
                مشخصاتی مثل رنگ، سایز یا حافظه که این کالا را توصیف می‌کنند و در
                فیلترهای فروشگاه دیده می‌شوند. هر رنگ یا سایز دیگر، یک کالای جدا با
                موجودی خودش است.
              </p>
              {attributes.length === 0 ? (
                <p className="small muted">
                  هنوز ویژگی‌ای تعریف نشده است؛ از بخش «ویژگی‌ها» اضافه کنید.
                </p>
              ) : (
                <div className="grid cols-2">
                  {orderedAttributes.map((attribute) => (
                    <Field
                      key={attribute.id}
                      label={`${attribute.title}${attribute.unit ? ` (${attribute.unit})` : ''}${
                        requiredIds.has(attribute.id) ? ' *' : ''
                      }`}
                      hint={requiredIds.has(attribute.id) ? 'برای این دسته‌بندی اجباری است' : undefined}
                    >
                      {attribute.type === 'select' || attribute.type === 'color' ? (
                        <select
                          className="select"
                          value={productAttributes[attribute.id] ?? ''}
                          onChange={(event) =>
                            setProductAttributes((current) => ({
                              ...current,
                              [attribute.id]: event.target.value,
                            }))
                          }
                        >
                          <option value="">—</option>
                          {(attribute.options ?? []).map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.value}
                            </option>
                          ))}
                        </select>
                      ) : attribute.type === 'boolean' ? (
                        <select
                          className="select"
                          value={String(productAttributes[attribute.id] ?? '')}
                          onChange={(event) =>
                            setProductAttributes((current) => ({
                              ...current,
                              [attribute.id]: event.target.value,
                            }))
                          }
                        >
                          <option value="">—</option>
                          <option value="true">دارد</option>
                          <option value="false">ندارد</option>
                        </select>
                      ) : (
                        <input
                          className="input"
                          inputMode={attribute.type === 'number' ? 'numeric' : 'text'}
                          value={productAttributes[attribute.id] ?? ''}
                          onChange={(event) =>
                            setProductAttributes((current) => ({
                              ...current,
                              [attribute.id]: event.target.value,
                            }))
                          }
                        />
                      )}
                    </Field>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {tab === 'images' ? (
            <div className="stack">
              {!isEdit ? (
                <p className="tiny muted">
                  تصاویر و ویدیویی که اینجا انتخاب کنید، با زدن «ذخیره» همراه کالا آپلود می‌شوند.
                </p>
              ) : null}
              <label
                className="btn btn-soft"
                style={{ alignSelf: 'flex-start' }}
                aria-disabled={uploading || saving}
              >
                {uploading ? <span className="spinner" /> : <Upload size={15} />}
                {uploading ? 'در حال آپلود…' : isEdit ? 'آپلود تصویر' : 'افزودن تصویر'}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  disabled={uploading || saving}
                  onChange={isEdit ? uploadImages : queueImages}
                />
              </label>

              {shownImages.length === 0 ? (
                <p className="small muted">
                  <ImageOff size={14} /> تصویری ثبت نشده است.
                </p>
              ) : (
                <div className="grid cols-4">
                  {shownImages.map((image, index) => (
                    <div className="card card-pad stack" key={image.key} style={{ gap: 8 }}>
                      {/* Square and zoomed to fill, exactly as the shop shows it. */}
                      <img
                        src={image.src}
                        alt=""
                        style={{
                          width: '100%',
                          aspectRatio: '1 / 1',
                          objectFit: 'cover',
                          borderRadius: 'var(--radius-sm)',
                        }}
                      />
                      {/* The first picture is the one every listing shows. */}
                      {index === 0 ? (
                        <span className="badge badge-success" style={{ alignSelf: 'center' }}>
                          تصویر اصلی
                        </span>
                      ) : (
                        <Button
                          variant="soft"
                          size="sm"
                          disabled={saving}
                          onClick={() => (isEdit ? makeCover(image.key) : coverPendingImage(image.key))}
                        >
                          تصویر اصلی شود
                        </Button>
                      )}
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={saving}
                        onClick={() => (isEdit ? removeImage(image.key) : dropPendingImage(image.key))}
                      >
                        <Trash2 size={14} />
                        حذف
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="stack video-section">
                <div className="row-between">
                  <strong className="small">
                    <Film size={15} /> ویدیوی محصول
                  </strong>
                  <span className="tiny muted">
                    یک ویدیو، حداکثر ۳۰ ثانیه، MP4 با فرمت H.264، تا ۵۰ مگابایت
                  </span>
                </div>

                {shownVideo ? (
                  <div className="video-preview">
                    <video
                      key={shownVideo.src}
                      src={shownVideo.src}
                      poster={shownImages[0]?.src}
                      controls
                      playsInline
                      preload="metadata"
                    />
                    <div className="tiny muted">
                      {shownVideo.durationMs ? `${seconds(shownVideo.durationMs)} ثانیه` : null}
                      {shownVideo.sizeBytes ? ` — ${megabytes(shownVideo.sizeBytes)} مگابایت` : null}
                    </div>
                  </div>
                ) : (
                  <p className="small muted">ویدیویی ثبت نشده است.</p>
                )}

                {videoProgress !== null ? (
                  <div className="upload-progress" aria-live="polite">
                    <div className="upload-progress-bar">
                      <span style={{ width: `${Math.round(videoProgress * 100)}%` }} />
                    </div>
                    <span className="tiny muted">
                      {videoProgress < 1
                        ? `در حال آپلود… ${Math.round(videoProgress * 100).toLocaleString('fa-IR')}٪`
                        : 'در حال بررسی ویدیو…'}
                    </span>
                  </div>
                ) : (
                  <div className="row" style={{ gap: 8 }}>
                    <label className="btn btn-soft" aria-disabled={saving}>
                      <Upload size={15} />
                      {shownVideo
                        ? 'جایگزینی ویدیو'
                        : isEdit
                          ? 'آپلود ویدیو'
                          : 'افزودن ویدیو'}
                      <input
                        type="file"
                        accept="video/mp4,video/quicktime,.mp4,.m4v,.mov"
                        hidden
                        disabled={saving}
                        onChange={isEdit ? uploadVideo : queueVideo}
                      />
                    </label>
                    {shownVideo ? (
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={saving}
                        onClick={isEdit ? removeVideo : dropPendingVideo}
                      >
                        <Trash2 size={14} />
                        حذف ویدیو
                      </Button>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}

    </Modal>
  );
}
