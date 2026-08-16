"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { categories as seedCategories, locations as seedLocations, products as seedProducts, promotions as seedPromotions } from "./data";
import { PaymentRules, PrivacyPolicy } from "./LegalContent";
import type { CartLine, Category, PickupLocation, Product, Promotion } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || (process.env.NODE_ENV === "production" ? "/api" : "http://localhost:4000/api");
type SiteSettings = { legalName: string; qualityControl: string; telegram: string };
type SushiView = "catalog" | "promo" | "order" | "payment" | "privacy";

type SushiAppProps = {
  initialCategoryId?: number;
  initialView?: SushiView;
};

function MaterialIcon({ children }: { children: string }) {
  return <span className="material-icons" aria-hidden="true">{children}</span>;
}

function Header({
  cartCount,
  cartOpen,
  location,
  menuOpen,
  onCart,
  onCartPreviewEnter,
  onCartPreviewLeave,
  onCatalog,
  onLocation,
  onLogin,
  onMenu,
  onPromo,
}: {
  cartCount: number;
  cartOpen: boolean;
  location: PickupLocation | null;
  menuOpen: boolean;
  onCart: () => void;
  onCartPreviewEnter: () => void;
  onCartPreviewLeave: () => void;
  onCatalog: () => void;
  onLocation: () => void;
  onLogin: () => void;
  onMenu: () => void;
  onPromo: () => void;
}) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <button className="logo-button" onClick={onCatalog} aria-label="На главную">
          <img src="/assets/icons/logo.svg" alt="ДААНА СУШИ" />
        </button>
        <button className="store-selector" onClick={onLocation}>
          <MaterialIcon>storefront</MaterialIcon>
          <span>{location?.name || "ВЫБЕРИТЕ ТОЧКУ"}</span>
          <MaterialIcon>arrow_drop_down</MaterialIcon>
        </button>
        <div className="header-actions">
          <button className="header-action" onClick={onPromo}>
            <img className="header-action-icon promo-icon" src="/assets/icons/promo.svg" alt="" /><span>Акции</span>
          </button>
          <button className="header-action" onClick={onLogin}>
            <img className="header-action-icon login-icon" src="/assets/icons/account.svg" alt="" /><span>Войти</span>
          </button>
          <button className={`cart-button ${cartOpen ? "active" : ""}`} onClick={onCart} onMouseEnter={onCartPreviewEnter} onMouseLeave={onCartPreviewLeave} aria-label="Корзина">
            <img src="/assets/icons/cart.svg" alt="" />
            {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
          </button>
          <button className="mobile-menu-button" onClick={onMenu} aria-label={menuOpen ? "Закрыть меню" : "Меню"}><MaterialIcon>{menuOpen ? "close" : "menu"}</MaterialIcon></button>
        </div>
      </div>
    </header>
  );
}

function CategoryTabs({ items, selectedId, onSelect }: { items: Category[]; selectedId: number; onSelect: (id: number) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [canMoveLeft, setCanMoveLeft] = useState(false);
  const [canMoveRight, setCanMoveRight] = useState(true);
  const syncArrows = () => {
    const element = scroller.current;
    if (!element) return;
    setCanMoveLeft(element.scrollLeft > 2);
    setCanMoveRight(element.scrollLeft + element.clientWidth < element.scrollWidth - 2);
  };
  const move = (direction: number) => scroller.current?.scrollBy({ left: direction * 180, behavior: "smooth" });
  return (
    <nav className="category-nav" aria-label="Категории меню">
      <button className="category-arrow category-arrow-left" type="button" aria-label="Предыдущие категории" disabled={!canMoveLeft} onClick={() => move(-1)}><MaterialIcon>chevron_left</MaterialIcon></button>
      <div className="category-scroller" ref={scroller} onScroll={syncArrows}>
        {items.filter((category) => category.active).map((category) => (
          <button
            className={category.id === selectedId ? "active" : ""}
            key={category.id}
            onClick={() => onSelect(category.id)}
          >
            {category.name}
          </button>
        ))}
      </div>
      <button className="category-arrow category-arrow-right" type="button" aria-label="Следующие категории" disabled={!canMoveRight} onClick={() => move(1)}><MaterialIcon>chevron_right</MaterialIcon></button>
    </nav>
  );
}

function QuantityControl({ quantity, onDecrease, onIncrease }: { quantity: number; onDecrease: () => void; onIncrease: () => void }) {
  if (quantity === 0) {
    return (
      <button className="round-icon-button add-only" onClick={onIncrease} aria-label="Добавить в корзину">
        <MaterialIcon>add_circle_outline</MaterialIcon>
      </button>
    );
  }
  return (
    <div className="quantity-control">
      <button className="round-icon-button" onClick={onDecrease} aria-label="Уменьшить количество">
        <MaterialIcon>remove_circle_outline</MaterialIcon>
      </button>
      <strong>{quantity}</strong>
      <button className="round-icon-button" onClick={onIncrease} aria-label="Увеличить количество">
        <MaterialIcon>add_circle_outline</MaterialIcon>
      </button>
    </div>
  );
}

function ProductCard({ product, quantity, onDecrease, onIncrease }: { product: Product; quantity: number; onDecrease: () => void; onIncrease: () => void }) {
  return (
    <article className="product-card">
      <div className="product-card-inner">
        <img src={product.image} alt={product.name} loading="lazy" />
        <h2>{product.name}</h2>
        <div className="product-card-buy">
          <div className="price-pill">{product.price} ₽</div>
          <QuantityControl quantity={quantity} onDecrease={onDecrease} onIncrease={onIncrease} />
        </div>
      </div>
    </article>
  );
}

function HeroCarousel({ onOpen }: { onOpen: () => void }) {
  const slides = [
    { image: "/assets/promos/1734418347433.webp", alt: "Скидка в день рождения 15%" },
    { image: "/assets/promos/1766921524730.webp", alt: "Скидка последний час 20%" },
  ];
  const [active, setActive] = useState(1);
  useEffect(() => {
    const timer = window.setInterval(() => setActive((current) => (current + 1) % slides.length), 5000);
    return () => window.clearInterval(timer);
  }, [slides.length]);
  const move = (delta: number) => setActive((current) => (current + delta + slides.length) % slides.length);
  return (
    <div className="hero-promo" role="group" aria-label="Акции">
      <span className="visually-hidden">Скидка последний час</span>
      <button className="hero-slide" onClick={onOpen} aria-label={slides[active].alt}>
        <img src={slides[active].image} alt={slides[active].alt} />
      </button>
      <button className="hero-arrow hero-arrow-left" onClick={() => move(-1)} aria-label="Предыдущая акция"><MaterialIcon>chevron_left</MaterialIcon></button>
      <button className="hero-arrow hero-arrow-right" onClick={() => move(1)} aria-label="Следующая акция"><MaterialIcon>chevron_right</MaterialIcon></button>
    </div>
  );
}

function CartPanel({ lines, onCheckout, onDecrease, onEnter, onIncrease, onLeave, onRemove }: {
  lines: CartLine[];
  onCheckout: () => void;
  onDecrease: (id: number) => void;
  onEnter: () => void;
  onIncrease: (id: number) => void;
  onLeave: () => void;
  onRemove: (id: number) => void;
}) {
  const total = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  return (
    <aside className="cart-panel" aria-label="Корзина" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {lines.length === 0 ? (
        <div className="empty-cart"><MaterialIcon>shopping_cart</MaterialIcon><span>Корзина пока пуста</span></div>
      ) : (
        <>
          <div className="cart-lines">
            {lines.map((line) => (
              <div className="cart-line" key={line.id}>
                <div className="cart-line-image"><img src={line.image} alt={line.name} /></div>
                <div className="cart-line-main">
                  <div className="cart-line-head"><strong>{line.name}</strong><button onClick={() => onRemove(line.id)} aria-label={`Удалить ${line.name}`}><MaterialIcon>close</MaterialIcon></button></div>
                  <div className="cart-line-bottom"><QuantityControl quantity={line.quantity} onDecrease={() => onDecrease(line.id)} onIncrease={() => onIncrease(line.id)} /><span className="price-pill small">{line.price * line.quantity} ₽</span></div>
                </div>
              </div>
            ))}
          </div>
          <button className="cart-total" onClick={onCheckout}><span>Сумма заказа:</span><strong>{total} р</strong></button>
        </>
      )}
    </aside>
  );
}

function LocationPicker({ compact = false, items, selected, onChange }: { compact?: boolean; items: PickupLocation[]; selected: PickupLocation | null; onChange: (location: PickupLocation) => void }) {
  const [open, setOpen] = useState(false);
  const activeItems = items.filter((item) => item.active);
  const label = selected ? `Выбрано: ${selected.address}` : "Выберите точку, где вы заберете заказ";
  const listboxId = compact ? "pickup-location-options" : "dialog-location-options";
  return (
    <div className={`location-picker ${compact ? "compact" : ""}`}>
      <button className="location-select-display" type="button" role="combobox" aria-controls={listboxId} aria-expanded={open} aria-haspopup="listbox" aria-label={label} onClick={() => setOpen((value) => !value)}>
        <span>{selected ? <><strong>Выбрано:</strong>&nbsp; {selected.address}</> : label}</span>
        <MaterialIcon>{open ? "arrow_drop_up" : "arrow_drop_down"}</MaterialIcon>
      </button>
      {open && (
        <div className="location-options" id={listboxId} role="listbox" aria-label="Точки самовывоза">
          {activeItems.map((item) => (
            <button type="button" role="option" aria-selected={selected?.id === item.id} className={selected?.id === item.id ? "selected" : ""} key={item.id} onClick={() => { onChange(item); setOpen(false); }}>
              <span className="location-option-copy"><strong>{item.name}</strong><small>{item.address}</small></span>
              <span className="location-option-status">закрыто до<br />{item.opensAt}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LocationModal({ current, items, onSelect }: { current: PickupLocation | null; items: PickupLocation[]; onSelect: (location: PickupLocation) => void }) {
  const [selectedId, setSelectedId] = useState<number | "">(current?.id || "");
  const selected = items.find((location) => location.id === selectedId) || null;
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card location-modal" role="dialog" aria-modal="true" aria-labelledby="location-title">
        <h2 id="location-title" className="visually-hidden">Выберите точку, где вы заберете заказ</h2>
        <div className="location-top-row">
          <div className="select-shell">
            <span className="location-target" aria-hidden="true"><span /></span>
            <LocationPicker items={items} selected={selected} onChange={(item) => setSelectedId(item.id)} />
          </div>
        </div>
        {selected && (
          <div className="location-details">
            <a href={`tel:${selected.phone.replace(/\D/g, "")}`}><MaterialIcon>phone</MaterialIcon>{selected.phone.replaceAll("-", "‒")}</a>
            <span className="location-hours"><MaterialIcon>schedule</MaterialIcon><b>{selected.hours}</b></span>
          </div>
        )}
        <div className="map-visual" aria-label="Карта точек">
          <iframe title="Яндекс Карты" src="https://yandex.ru/map-widget/v1/?ll=104.297709%2C52.286191&z=13" />
          {items.slice(0, 3).map((location, index) => (
            <button className={`map-marker marker-${index + 1} ${selectedId === location.id ? "selected" : ""}`} key={location.id} onClick={() => setSelectedId(location.id)} aria-label={location.name}>
              <span className="marker-dot">С</span><span className="marker-label"><strong>{location.name}</strong><small>закрыто до {location.opensAt}</small></span>
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button className="primary-button" disabled={!selected} onClick={() => selected && onSelect(selected)}>Ок</button>
        </div>
      </section>
    </div>
  );
}

function LoginModal({ onClose }: { onClose: () => void }) {
  const [phone, setPhone] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const requestCode = async () => {
    setMessage("");
    try {
      const response = await fetch(`${API_URL}/auth/request-code`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось отправить код");
      setCodeSent(true);
      setMessage(result.devCode ? `Код отправлен. Код для локального запуска: ${result.devCode}.` : "Код отправлен.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось отправить код");
    }
  };
  const verifyCode = async () => {
    setMessage("");
    try {
      const response = await fetch(`${API_URL}/auth/verify-code`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, code }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось войти");
      localStorage.setItem("sushi-customer", JSON.stringify(result.customer));
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось войти");
    }
  };
  return (
    <div className="modal-backdrop">
      <div className="login-dialog-wrap">
        <section className="login-modal" role="dialog" aria-modal="true" aria-labelledby="login-title">
          <div className="login-circle"><MaterialIcon>key</MaterialIcon></div>
          <h2 id="login-title">Личный кабинет</h2>
          <div className="login-caption">Введите номер телефона и вам поступит звонок в течении минуты, необходимо будет ввести последние <strong>4 цифры</strong> входящего номера:<div className="phone-example">+7 000 000 <strong>XXXX</strong></div></div>
          <label className="login-phone-field">{!codeSent && <span>+7</span>}<input value={codeSent ? code : phone} onChange={(event) => codeSent ? setCode(event.target.value.replace(/\D/g, "").slice(0, 4)) : setPhone(event.target.value)} placeholder={codeSent ? "Последние 4 цифры" : "Телефон"} inputMode={codeSent ? "numeric" : "tel"} autoComplete={codeSent ? "one-time-code" : "tel"} /></label>
          <div className="login-submit-row"><button onClick={codeSent ? verifyCode : requestCode} disabled={codeSent ? code.length !== 4 : phone.replace(/\D/g, "").length < 10}>{codeSent ? "Войти" : "Выслать код"}</button></div>
          <div className="login-consent">Нажимая кнопку, я даю <strong>согласие</strong> на обработку персональных данных.</div>
          {message && <small className="form-message">{message}</small>}
        </section>
        <button className="login-external-close" onClick={onClose} aria-label="Закрыть"><MaterialIcon>close</MaterialIcon></button>
      </div>
    </div>
  );
}

function OrderView({ lines, products, location, locations, onChangeQuantity, onClear, onLocationChange, onNeedLocation, onSuccess }: {
  lines: CartLine[];
  products: Product[];
  location: PickupLocation | null;
  locations: PickupLocation[];
  onChangeQuantity: (id: number, delta: number) => void;
  onClear: () => void;
  onLocationChange: (location: PickupLocation) => void;
  onNeedLocation: () => void;
  onSuccess: (number: string) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [comment, setComment] = useState("");
  const [promo, setPromo] = useState("");
  const [promoMessage, setPromoMessage] = useState("");
  const [readyTime, setReadyTime] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const total = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const extras = products.filter((product) => product.categoryId === 5 && product.active);
  const timeData = useMemo(() => {
    const now = new Date();
    const display = now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    const first = new Date(now.getTime() + 90 * 60 * 1000);
    first.setMinutes(Math.ceil(first.getMinutes() / 15) * 15, 0, 0);
    const slots = Array.from({ length: 5 }, (_, index) => new Date(first.getTime() + index * 15 * 60 * 1000).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }));
    return { display, slots };
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!location) { onNeedLocation(); return; }
    if (!lines.length) { setError("Добавьте товары в корзину"); return; }
    setPending(true); setError("");
    const details = [comment, readyTime ? `Приготовить к: ${readyTime}` : "", promo ? `Промокод: ${promo}` : ""].filter(Boolean).join(" · ");
    const payload = { customerName: name, customerPhone: phone, comment: details, locationId: location.id, items: lines.map((line) => ({ productId: line.id, quantity: line.quantity })) };
    try {
      const response = await fetch(`${API_URL}/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось создать заказ");
      onSuccess(result.orderNumber);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Не удалось создать заказ");
    } finally { setPending(false); }
  };
  return (
    <section className="order-page">
      <div className="order-heading-row">
        <div className="order-heading-visual"><img src="/assets/order/HeadingSection.webp" alt="Ваш заказ" /><button type="button" onClick={onClear}>Очистить корзину</button></div>
        <div className="order-summary">
          <div className="order-summary-total"><strong>Корзина:</strong><b>{total} ₽</b></div>
          <div className="order-promo"><input value={promo} onChange={(event) => setPromo(event.target.value)} placeholder="Промокод" aria-label="Промокод" /><button type="button" onClick={() => setPromoMessage(promo.trim() ? "Промокод не найден" : "Введите промокод")}>применить</button></div>
          {promoMessage && <small className="order-promo-message">{promoMessage}</small>}
        </div>
      </div>
      <div className="order-lines">
        {lines.length ? lines.map((line) => <article className="order-line" key={line.id}><img src={line.image} alt={line.name} /><strong>{line.name}</strong><span className="price-pill">{line.price * line.quantity} ₽</span><QuantityControl quantity={line.quantity} onDecrease={() => onChangeQuantity(line.id, -1)} onIncrease={() => onChangeQuantity(line.id, 1)} /></article>) : <div className="order-empty">Корзина пока пуста</div>}
      </div>
      <h2 className="order-extras-title">Не забудьте к вашему заказу</h2>
      <div className="order-extras" role="region" aria-label="Дополнительно к заказу">
        {extras.map((product) => {
          const line = lines.find((item) => item.id === product.id);
          return <article className={`order-extra-card extra-${product.id}`} key={product.id}><img src={product.image} alt={product.name} /><h3>{product.name}</h3><span className="price-pill">{product.price} ₽</span><QuantityControl quantity={line?.quantity || 0} onDecrease={() => onChangeQuantity(product.id, -1)} onIncrease={() => onChangeQuantity(product.id, 1)} /></article>;
        })}
      </div>
      <div className="order-location-block">
        <div className="order-location-shell"><span className="order-location-pin"><MaterialIcon>edit_location</MaterialIcon></span><LocationPicker compact items={locations} selected={location} onChange={onLocationChange} /></div>
        {location && <div className="order-location-details"><a href={`tel:${location.phone.replace(/\D/g, "")}`}><MaterialIcon>phone</MaterialIcon>{location.phone.replaceAll("-", "‒")}</a><span><MaterialIcon>schedule</MaterialIcon>{location.hours}</span></div>}
      </div>
      <form className="order-form" onSubmit={submit}>
        <h2>Оформление заказа</h2>
        <label><span className="visually-hidden">Имя</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Имя" aria-label="Имя" required /></label>
        <label><span className="visually-hidden">Телефон</span><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Телефон" aria-label="Телефон" inputMode="tel" required /></label>
        <label><span className="visually-hidden">Комментарий к заказу</span><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Комментарий к заказу" aria-label="Комментарий к заказу" /></label>
        <div className="order-ready"><strong>Приготовить к: <b>{timeData.display}</b></strong><div className="order-time-slots">{timeData.slots.map((slot) => <button type="button" className={readyTime === slot ? "active" : ""} key={slot} onClick={() => setReadyTime(slot)}>{slot}</button>)}<button type="button" className={readyTime === "Выбрать" ? "active" : ""} onClick={() => setReadyTime("Выбрать")}>Выбрать</button></div></div>
        {error && <div className="form-error order-error">{error}</div>}
        <button className="order-pay" disabled={pending || !lines.length}>{pending ? "СОЗДАЕМ ЗАКАЗ…" : `ОПЛАТИТЬ ${total} ₽`}</button>
        <p className="order-consent">Нажимая кнопку, я даю <strong>согласие</strong> на обработку персональных данных.</p>
      </form>
    </section>
  );
}

function Footer({ settings }: { settings: SiteSettings }) {
  return (
    <footer className="site-footer">
      <div className="footer-container">
        <div className="footer-top">
          <div className="footer-brand"><img src="/assets/icons/logo.svg" alt="ДААНА СУШИ" /><span>ДААНА СУШИ © 2026 {settings.legalName}</span></div>
          <a className="footer-payment" href="/payment-rule">*правила оплаты на сайте*</a>
          <div className="quality"><span>{settings.qualityControl}</span><div><a href="https://max.ru/u/f9LHodD0cOJQU8ezxABIhMctIqDOYaOcHXohx26DyAz9nyG2JMqytsjjBbQ" aria-label="Max"><img src="/assets/icons/Max_Messenger.png" alt="" /></a><a href={settings.telegram} aria-label="Telegram"><img src="/assets/icons/Telegram_Messenger.png" alt="" /></a></div></div>
        </div>
        <div className="footer-privacy"><a href="/privacy">Политика обработки персональных данных</a></div>
        <div className="footer-recaptcha">Наш сайт защищен с помощью reCAPTCHA и соответствует <a href="https://policies.google.com/privacy">Политике конфиденциальности</a> и <a href="https://policies.google.com/terms?hl=ru">Условиям использования</a> Google.</div>
      </div>
    </footer>
  );
}

export default function SushiApp({ initialCategoryId = 1, initialView = "catalog" }: SushiAppProps) {
  const [categoryId, setCategoryId] = useState(initialCategoryId);
  const [view, setView] = useState<SushiView>(initialView);
  const [cart, setCart] = useState<Record<number, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [location, setLocation] = useState<PickupLocation | null>(null);
  const [locationOpen, setLocationOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [orderNumber, setOrderNumber] = useState("");
  const [geoNoticeOpen, setGeoNoticeOpen] = useState(false);
  const [headerHidden, setHeaderHidden] = useState(false);
  const [categoryList, setCategoryList] = useState<Category[]>(seedCategories);
  const [productList, setProductList] = useState<Product[]>(seedProducts);
  const [locationList, setLocationList] = useState<PickupLocation[]>(seedLocations);
  const [promotionList, setPromotionList] = useState<Promotion[]>(seedPromotions);
  const [siteSettings, setSiteSettings] = useState<SiteSettings>({ legalName: "ИП Багаутдинова", qualityControl: "Отдел контроля качества", telegram: "https://t.me/BIG_REST_TEAM" });
  const cartCloseTimer = useRef<number | null>(null);
  const geoNoticeTimer = useRef<number | null>(null);

  // Client storage and the API are external systems; hydrate them after the SSR pass.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      const savedCart = localStorage.getItem("sushi-cart"); if (savedCart) setCart(JSON.parse(savedCart));
      const savedLocation = localStorage.getItem("sushi-location");
      if (savedLocation) setLocation(seedLocations.find((item) => item.id === Number(savedLocation)) || null);
      else { setLocationOpen(true); setGeoNoticeOpen(true); }
    } catch { setLocationOpen(true); setGeoNoticeOpen(true); }
    Promise.all([
      fetch(`${API_URL}/catalog`).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(`${API_URL}/locations`).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(`${API_URL}/promotions`).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(`${API_URL}/settings`).then((response) => response.ok ? response.json() : Promise.reject()),
    ]).then(([catalog, remoteLocations, remotePromotions, remoteSettings]) => {
      setCategoryList(catalog.categories); setProductList(catalog.products); setLocationList(remoteLocations); setPromotionList(remotePromotions);
      if (remoteSettings.general) setSiteSettings(remoteSettings.general);
    }).catch(() => { /* Static seed keeps the storefront usable while the API starts. */ });
  }, []);

  useEffect(() => { localStorage.setItem("sushi-cart", JSON.stringify(cart)); }, [cart]);

  useEffect(() => {
    let previousY = window.scrollY;
    const onScroll = () => {
      const currentY = window.scrollY;
      if (currentY <= 8) setHeaderHidden(false);
      else if (currentY > previousY && currentY > 72) setHeaderHidden(true);
      else if (currentY < previousY) setHeaderHidden(false);
      previousY = currentY;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const syncRoute = () => {
      const path = window.location.pathname;
      if (path === "/promo") setView("promo");
      else if (path === "/order") setView("order");
      else if (path === "/payment-rule") setView("payment");
      else if (path === "/privacy") setView("privacy");
      else {
        const match = path.match(/^\/catalog\/(\d+)/);
        if (match) { setCategoryId(Number(match[1])); setView("catalog"); }
      }
      setCartOpen(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  const visibleProducts = productList.filter((product) => product.categoryId === categoryId && product.active);
  const lines = useMemo(() => productList.filter((product) => cart[product.id] > 0).map((product) => ({ ...product, quantity: cart[product.id] })), [cart, productList]);
  const cartCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const changeQuantity = (id: number, delta: number) => setCart((current) => ({ ...current, [id]: Math.max(0, (current[id] || 0) + delta) }));
  const navigateCategory = (id: number) => { setCategoryId(id); setView("catalog"); setHeaderHidden(false); setCartOpen(false); window.history.pushState({}, "", `/catalog/${id}`); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const navigatePromo = () => { setView("promo"); setHeaderHidden(false); setCartOpen(false); window.history.pushState({}, "", "/promo"); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const navigateOrder = () => { setView("order"); setHeaderHidden(false); setCartOpen(false); window.history.pushState({}, "", "/order"); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const navigatePayment = () => { setView("payment"); setHeaderHidden(false); setCartOpen(false); setMobileMenuOpen(false); window.history.pushState({}, "", "/payment-rule"); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const saveLocation = (chosen: PickupLocation) => { setLocation(chosen); localStorage.setItem("sushi-location", String(chosen.id)); setLocationOpen(false); };
  const openLocation = () => {
    setLocationOpen(true); setGeoNoticeOpen(true);
    if (geoNoticeTimer.current) window.clearTimeout(geoNoticeTimer.current);
    geoNoticeTimer.current = window.setTimeout(() => setGeoNoticeOpen(false), 5000);
  };
  const keepCartPreview = () => { if (cartCloseTimer.current) window.clearTimeout(cartCloseTimer.current); if (lines.length) setCartOpen(true); };
  const closeCartPreview = () => { if (cartCloseTimer.current) window.clearTimeout(cartCloseTimer.current); cartCloseTimer.current = window.setTimeout(() => setCartOpen(false), 140); };

  return (
    <div className={`site-shell ${headerHidden ? "header-hidden" : ""} ${view}-view`}>
      <Header cartCount={cartCount} cartOpen={cartOpen} location={location} menuOpen={mobileMenuOpen} onCart={navigateOrder} onCartPreviewEnter={keepCartPreview} onCartPreviewLeave={closeCartPreview} onCatalog={() => navigateCategory(1)} onLocation={openLocation} onLogin={() => setLoginOpen(true)} onMenu={() => setMobileMenuOpen((open) => !open)} onPromo={navigatePromo} />
      <CategoryTabs items={categoryList} selectedId={view === "catalog" ? categoryId : 0} onSelect={navigateCategory} />
      {mobileMenuOpen && <><button className="mobile-menu-scrim" onClick={() => setMobileMenuOpen(false)} aria-label="Закрыть меню" /><aside className="mobile-menu-panel" aria-label="Главное меню"><nav><button onClick={() => { setMobileMenuOpen(false); navigateCategory(1); }}><MaterialIcon>restaurant_menu</MaterialIcon><span>Блюда</span></button><button onClick={() => { setMobileMenuOpen(false); navigatePromo(); }}><MaterialIcon>card_giftcard</MaterialIcon><span>Акции</span></button><button onClick={navigatePayment}><MaterialIcon>receipt_long</MaterialIcon><span>Оплата</span></button><button onClick={() => { setMobileMenuOpen(false); setLoginOpen(true); }}><MaterialIcon>login</MaterialIcon><span>Кабинет</span></button></nav><div className="mobile-menu-brand"><span className="mobile-brand-mark" /><strong>ДААНА СУШИ — ЭТО КОГДА<br />УДОБНО И ВКУСНО</strong></div><div className="mobile-menu-quality"><strong>{siteSettings.qualityControl.replace("Отдел контроля качества", "Контроль качества")}</strong><div><a href="https://max.ru/u/f9LHodD0cOJQU8ezxABIhMctIqDOYaOcHXohx26DyAz9nyG2JMqytsjjBbQ"><img src="/assets/icons/Max_Messenger.png" alt="Max" /></a><a href={siteSettings.telegram}><img src="/assets/icons/Telegram_Messenger.png" alt="Telegram" /></a></div></div></aside></>}
      {cartOpen && <CartPanel lines={lines} onCheckout={navigateOrder} onEnter={keepCartPreview} onLeave={closeCartPreview} onDecrease={(id) => changeQuantity(id, -1)} onIncrease={(id) => changeQuantity(id, 1)} onRemove={(id) => setCart((current) => ({ ...current, [id]: 0 }))} />}
      <main className={`site-main ${view === "order" ? "order-main" : ""} ${view === "payment" || view === "privacy" ? "legal-main" : ""}`}>
        {view === "promo" ? (
          <section className="promotions-page">
            {promotionList.filter((promotion) => promotion.active).map((promotion) => (
              <article className="promotion-card" key={promotion.id}><img src={promotion.image} alt={promotion.title} /></article>
            ))}
          </section>
        ) : view === "order" ? (
          <OrderView lines={lines} products={productList} location={location} locations={locationList} onChangeQuantity={changeQuantity} onClear={() => setCart({})} onLocationChange={saveLocation} onNeedLocation={openLocation} onSuccess={(number) => { setOrderNumber(number); setCart({}); }} />
        ) : view === "payment" ? (
          <PaymentRules />
        ) : view === "privacy" ? (
          <PrivacyPolicy />
        ) : (
          <section className={`product-grid category-${categoryId}`}>
            {categoryId === 1 && <div className="product-slot hero-slot"><HeroCarousel onOpen={navigatePromo} /></div>}
            {visibleProducts.map((product) => <div className="product-slot card-slot" key={product.id}><ProductCard product={product} quantity={cart[product.id] || 0} onDecrease={() => changeQuantity(product.id, -1)} onIncrease={() => changeQuantity(product.id, 1)} /></div>)}
          </section>
        )}
      </main>
      <Footer settings={siteSettings} />
      {geoNoticeOpen && <div className="geo-notice" role="status"><span>Для удобства нахождения ближайшего магазина разрешите сайту определять ваше местоположение.</span><button onClick={() => setGeoNoticeOpen(false)} aria-label="Закрыть"><MaterialIcon>close</MaterialIcon></button></div>}
      {locationOpen && <LocationModal current={location} items={locationList} onSelect={saveLocation} />}
      {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} />}
      {orderNumber && <div className="modal-backdrop"><section className="modal-card success-modal"><MaterialIcon>check_circle</MaterialIcon><h2>Заказ принят</h2><p>Номер вашего заказа: <strong>{orderNumber}</strong></p><button className="primary-button" onClick={() => setOrderNumber("")}>Хорошо</button></section></div>}
    </div>
  );
}
