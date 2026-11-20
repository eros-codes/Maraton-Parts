import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Heart,
  ImageOff,
  Minus,
  Package,
  Play,
  Plus,
  RotateCcw,
  CreditCard,
  ShoppingCart,
  Truck,
} from 'lucide-react';
import { api } from '../lib/api';
import { useCart } from '../context/CartContext';
import { useWishlist } from '../context/WishlistContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { translateError } from '../lib/errorMessages';
import {
  basePrice,
  discountPercent,
  effectivePrice,
  formatToman,
  imageAt,
  imageSrcSet,
  imageUrl,
  returnWindowLabel,
  toPersianDigits,
} from '../lib/format';
import { useCatalog } from '../context/CatalogContext';
import { useInView } from '../lib/useInView';
import { usePageTitle } from '../lib/usePageTitle';
import ProductCard from '../components/product/ProductCard';
import {
  Breadcrumb,
  Button,
  EmptyState,
  Price,
  Stars,
} from '../components/ui/Primitives';

// "۰:۱۲" for a 12-second clip.
function formatClipLength(ms) {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return toPersianDigits(`${minutes}:${seconds}`);
}

export default function ProductDetail() {
  const { slug } = useParams();
  const { add } = useCart();
  const wishlist = useWishlist();
  const { isAuthenticated } = useAuth();
  const { shop } = useCatalog();
  const toast = useToast();

  const [product, setProduct] = useState(null);
  const [related, setRelated] = useState([]);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [activeImage, setActiveImage] = useState(0);
  const [adding, setAdding] = useState(false);
  const buyBoxRef = useRef(null);
  // On a phone the buy box is a long scroll away once the customer is
  // reading specs or reviews; a bar at the bottom takes over the moment
  // the box itself leaves the screen.
  const buyBoxVisible = useInView(buyBoxRef, [product?.id, loading]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setQuantity(1);
    setActiveImage(0);

    const path = /^\d+$/.test(slug) ? `/products/${slug}` : `/products/slug/${slug}`;

    api
      .get(path)
      .then((data) => {
        if (cancelled) return;
        setProduct(data);
        void api
          .get(`/products/${data.id}/related?limit=8`)
          .then((items) => !cancelled && setRelated(items ?? []))
          .catch(() => {});
        void api
          .get(`/comments?productId=${data.id}&limit=20`)
          .then((items) => !cancelled && setComments(items?.items ?? []))
          .catch(() => {});
      })
      .catch(() => {
        if (!cancelled) setProduct(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  // A product is one thing with one price and one stock count: a second
  // colour or capacity is a product of its own, with its own page.
  const images = product?.images ?? [];
  // The gallery: the photos, with the product's video (if it has one)
  // right after the cover photo, where it is seen without being in the way.
  const media = images.map((image) => ({ kind: 'image', image }));
  if (product?.video_url) {
    media.splice(Math.min(1, media.length), 0, { kind: 'video' });
  }
  const active = media[activeImage] ?? media[0];
  const poster = images[0] ? imageAt(images[0], 800) : undefined;
  const price = effectivePrice(product);
  const was = basePrice(product);
  const off = discountPercent(product);
  const stock = Number(product?.stock ?? 0);
  const canBuy = !!product && stock > 0;

  usePageTitle(product?.title);

  // Never more than is on the shelf: eight picked of something that has
  // two left went to the basket one unit at a time, two arrived and an
  // error explained the rest.
  useEffect(() => {
    if (stock > 0) setQuantity((value) => Math.min(value, stock));
  }, [stock]);

  const descriptiveValues = product?.attributeValues ?? [];

  const addToCart = async () => {
    if (!canBuy) return;
    setAdding(true);
    await add(product, quantity);
    setAdding(false);
  };

  const submitComment = async (event) => {
    event.preventDefault();
    // Held before the await: React clears event.currentTarget once the
    // handler yields, and resetting through it then threw - the review was
    // saved but the customer was shown an error.
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await api.post(
        '/comments',
        {
          productId: product.id,
          comment: form.get('comment'),
          rate: Number(form.get('rate')),
        },
        { auth: true },
      );
      toast.success('نظر شما ثبت شد و پس از تأیید نمایش داده می‌شود');
      formElement.reset();
    } catch (error) {
      toast.error(translateError(error));
    }
  };

  if (loading) {
    return (
      <div className="container page">
        <div className="pdp">
          <div className="skeleton" style={{ aspectRatio: '1 / 1', borderRadius: 22 }} />
          <div className="stack">
            <div className="skeleton" style={{ height: 28, width: '70%' }} />
            <div className="skeleton" style={{ height: 18, width: '40%' }} />
            <div className="skeleton" style={{ height: 160, marginTop: 20 }} />
          </div>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="container page">
        <div className="card">
          <EmptyState
            title="این کالا پیدا نشد"
            description="ممکن است حذف شده باشد یا آدرس اشتباه باشد."
            action={
              <Link className="btn btn-primary" to="/products">
                بازگشت به فروشگاه
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="container page">
      <Breadcrumb
        items={[
          { label: 'فروشگاه', to: '/products' },
          ...(product.categories?.length
            ? [
                {
                  label: product.categories[0].title,
                  to: `/products?categoryId=${product.categories[0].id}`,
                },
              ]
            : []),
          { label: product.title },
        ]}
      />

      <div className="pdp">
        <div className="gallery">
          <div className="gallery-main">
            {active?.kind === 'video' ? (
              <video
                // Keyed by the file, so a replaced video starts afresh.
                key={product.video_url}
                className="gallery-video"
                src={imageUrl(product.video_url)}
                poster={poster}
                controls
                playsInline
                preload="metadata"
              />
            ) : active ? (
              <img
                src={imageAt(active.image, 800)}
                srcSet={imageSrcSet(active.image)}
                // Full width on a phone, about half the page on a wide screen.
                sizes="(max-width: 900px) 100vw, 640px"
                alt={product.title}
              />
            ) : (
              <span className="muted">
                <ImageOff size={44} />
              </span>
            )}
            {off > 0 ? (
              <span
                className="badge badge-accent"
                style={{ position: 'absolute', top: 16, insetInlineStart: 16 }}
              >
                ٪{toPersianDigits(off)} تخفیف
              </span>
            ) : null}
          </div>

          {media.length > 1 ? (
            <div className="gallery-thumbs">
              {media.map((item, index) =>
                item.kind === 'video' ? (
                  <button
                    key="video"
                    className="gallery-thumb gallery-thumb-video"
                    data-active={index === activeImage}
                    onClick={() => setActiveImage(index)}
                    aria-label="پخش ویدیوی محصول"
                  >
                    {poster ? <img src={imageAt(images[0], 200)} alt="" loading="lazy" /> : null}
                    <span className="gallery-play">
                      <Play size={16} fill="currentColor" />
                    </span>
                    {product.video_duration_ms ? (
                      <span className="gallery-duration">
                        {formatClipLength(product.video_duration_ms)}
                      </span>
                    ) : null}
                  </button>
                ) : (
                  <button
                    key={item.image.id ?? index}
                    className="gallery-thumb"
                    data-active={index === activeImage}
                    onClick={() => setActiveImage(index)}
                  >
                    <img src={imageAt(item.image, 200)} alt="" loading="lazy" />
                  </button>
                ),
              )}
            </div>
          ) : null}
        </div>

        <div>
          <h1 className="pdp-title">{product.title}</h1>

          <div className="pdp-meta">
            {product.brand ? (
              <Link to={`/products?brandId=${product.brand.id}`} className="badge">
                {product.brand.title}
              </Link>
            ) : null}
            {Number(product.rating_count) > 0 ? (
              <Stars value={product.rating_avg} count={product.rating_count} />
            ) : (
              <span className="small muted">هنوز امتیازی ثبت نشده</span>
            )}
          </div>

          <div className="buy-box" ref={buyBoxRef}>
            <div className="buy-price">
              {stock > 0 ? (
                <Price now={price} was={was} off={off} />
              ) : (
                <span className="strong" style={{ color: 'var(--danger-600)' }}>
                  این کالا موجود نیست
                </span>
              )}

              {stock > 0 && stock <= 5 ? (
                <span className="badge badge-warning">
                  تنها {toPersianDigits(stock)} عدد باقی مانده
                </span>
              ) : null}
            </div>

            <div className="row buy-actions">
              <div className="qty">
                <button
                  onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                  disabled={quantity <= 1}
                  aria-label="کاهش"
                >
                  <Minus size={15} />
                </button>
                <span>{quantity.toLocaleString('fa-IR')}</span>
                <button
                  onClick={() => setQuantity((value) => Math.min(stock || 1, value + 1))}
                  disabled={quantity >= stock}
                  aria-label="افزایش"
                >
                  <Plus size={15} />
                </button>
              </div>

              <Button
                variant="primary"
                size="lg"
                onClick={addToCart}
                disabled={!canBuy}
                loading={adding}
                className="buy-cta"
              >
                <ShoppingCart size={18} />
                افزودن به سبد خرید
              </Button>

              <button
                className="icon-btn buy-wish"
                data-active={wishlist.has(product.id)}
                onClick={() => wishlist.toggle(product.id)}
                aria-label="علاقه‌مندی"
              >
                <Heart
                  size={19}
                  fill={wishlist.has(product.id) ? 'var(--accent-600)' : 'none'}
                  color={wishlist.has(product.id) ? 'var(--accent-600)' : undefined}
                />
              </button>
            </div>

            {Number(product.weight_grams) > 0 ? (
              <div className="small muted" style={{ marginTop: 14 }}>
                وزن با بسته‌بندی: {formatToman(product.weight_grams, { withUnit: false })} گرم
              </div>
            ) : null}
          </div>

          <div className="grid auto-grid pdp-trust" style={{ marginTop: 16 }}>
            {[
              { icon: Truck, title: 'ارسال سریع', sub: 'به سراسر ایران' },
              { icon: CreditCard, title: 'پرداخت آنلاین', sub: 'درگاه بانکی زرین‌پال' },
              { icon: RotateCcw, title: returnWindowLabel(shop.returnWindowDays), sub: 'طبق شرایط مرجوعی' },
              { icon: Package, title: 'پیگیری سفارش', sub: 'کد رهگیری در حساب کاربری' },
            ]
              .filter((item) => item.title)
              .map((item) => (
              <div className="card card-pad row" key={item.title} style={{ gap: 10 }}>
                <item.icon size={22} color="var(--gold-600)" />
                <div>
                  <div className="small strong">{item.title}</div>
                  <div className="tiny muted">{item.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* One after another, in the order a shopper reads them: what it is,
          the details, then what other buyers thought. */}
      <section className="section pdp-details">
        <div className="pdp-detail">
          <div className="section-head">
            <h2 className="section-title">توضیحات</h2>
          </div>
          <div className="card card-pad">
            <p style={{ lineHeight: 2.1, whiteSpace: 'pre-line' }}>
              {product.description || 'توضیحی برای این کالا ثبت نشده است.'}
            </p>
          </div>
        </div>

        <div className="pdp-detail">
          <div className="section-head">
            <h2 className="section-title">مشخصات</h2>
          </div>
          <div className="card card-pad">
            {descriptiveValues.length === 0 && !product.weight_grams ? (
              <p className="muted small">مشخصات فنی برای این کالا ثبت نشده است.</p>
            ) : (
              <table className="spec-table">
                <tbody>
                  {descriptiveValues.map((value) => (
                    <tr key={value.id}>
                      <td>{value.attribute?.title}</td>
                      <td>
                        {value.option?.value ??
                          value.value_text ??
                          (value.value_number !== null && value.value_number !== undefined
                            ? `${Number(value.value_number).toLocaleString('fa-IR')} ${value.attribute?.unit ?? ''}`
                            : value.value_boolean
                              ? 'دارد'
                              : 'ندارد')}
                      </td>
                    </tr>
                  ))}
                  {product.weight_grams ? (
                    <tr>
                      <td>وزن</td>
                      <td>{product.weight_grams.toLocaleString('fa-IR')} گرم</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="pdp-detail" id="reviews">
          <div className="section-head">
            <h2 className="section-title">
              نظرات{' '}
              <span className="muted small">({comments.length.toLocaleString('fa-IR')})</span>
            </h2>
          </div>
          <div className="card card-pad">
            <div>
              {isAuthenticated ? (
                <form onSubmit={submitComment} className="stack" style={{ marginBottom: 20 }}>
                  <div className="row" style={{ gap: 10 }}>
                    <span className="small strong">امتیاز شما:</span>
                    <select name="rate" className="select" style={{ width: 120 }} defaultValue="5">
                      {[5, 4, 3, 2, 1].map((value) => (
                        <option key={value} value={value}>
                          {toPersianDigits(value)} ستاره
                        </option>
                      ))}
                    </select>
                  </div>
                  <textarea
                    name="comment"
                    className="textarea"
                    placeholder="تجربه‌تان از این کالا را بنویسید…"
                    required
                  />
                  <Button type="submit" variant="soft" style={{ alignSelf: 'flex-start' }}>
                    ثبت نظر
                  </Button>
                </form>
              ) : (
                <p className="small muted">
                  برای ثبت نظر ابتدا <Link to="/login" style={{ color: 'var(--brand-600)' }}>وارد شوید</Link>.
                </p>
              )}

              {comments.length === 0 ? (
                <p className="muted small">هنوز نظری برای این کالا ثبت نشده است.</p>
              ) : (
                comments.map((comment) => (
                  <div className="comment" key={comment.id}>
                    <div className="spread">
                      <span className="strong small">
                        {comment.user?.display_name ?? 'کاربر ماراتون پارتز'}
                      </span>
                      <Stars value={comment.rate} />
                    </div>
                    <p className="small" style={{ marginTop: 6 }}>
                      {comment.comment}
                    </p>
                  </div>
                ))
              )}
          </div>
          </div>
        </div>
      </section>

      {related.length > 0 ? (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">کالاهای مشابه</h2>
          </div>
          <div className="product-grid">
            {related.map((item) => (
              <ProductCard key={item.id} product={item} />
            ))}
          </div>
        </section>
      ) : null}

      <div className="mobile-bar" data-hidden={buyBoxVisible} aria-hidden={buyBoxVisible}>
        <div className="mobile-bar-info">
          {stock > 0 ? (
            <Price now={price} was={was} off={off} />
          ) : (
            <span className="small strong" style={{ color: 'var(--danger-600)' }}>
              ناموجود
            </span>
          )}
        </div>
        <Button
          variant="primary"
          onClick={addToCart}
          disabled={!canBuy}
          loading={adding}
          tabIndex={buyBoxVisible ? -1 : 0}
        >
          <ShoppingCart size={17} />
          {canBuy ? 'افزودن به سبد' : 'ناموجود'}
        </Button>
      </div>
    </div>
  );
}
