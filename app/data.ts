import type { Category, PickupLocation, Product, Promotion } from "./types";

export const categories: Category[] = [
  { id: 1, name: "Роллы", slug: "rolls", sortOrder: 1, active: true },
  { id: 2, name: "Онигири", slug: "onigiri", sortOrder: 2, active: true },
  { id: 3, name: "Наборы", slug: "sets", sortOrder: 3, active: true },
  { id: 4, name: "Напитики", slug: "drinks", sortOrder: 4, active: true },
  { id: 7, name: "Суширрито", slug: "sushirrito", sortOrder: 5, active: true },
  { id: 5, name: "Дополнительно", slug: "extras", sortOrder: 6, active: true },
];

const image = (name: string) => `/assets/products/${name}.webp`;

export const products: Product[] = [
  { id: 1, categoryId: 1, name: "Филадельфия", price: 68, image: image("1735210545313"), active: true, sortOrder: 1 },
  { id: 2, categoryId: 1, name: "Филадельфия эби лайт", price: 68, image: image("1735210524708"), active: true, sortOrder: 2 },
  { id: 3, categoryId: 1, name: "Филадельфия лайт с огурцом", price: 55, image: image("1735210574116"), active: true, sortOrder: 3 },
  { id: 4, categoryId: 1, name: "Гейша", price: 48, image: image("1735210656070"), active: true, sortOrder: 4 },
  { id: 5, categoryId: 1, name: "Калифорния сяке", price: 49, image: image("1735210708172"), active: true, sortOrder: 5 },
  { id: 6, categoryId: 1, name: "Чидори", price: 49, image: image("1735210762773"), active: true, sortOrder: 6 },
  { id: 7, categoryId: 1, name: "Сяке ясай", price: 48, image: image("1735210808070"), active: true, sortOrder: 7 },
  { id: 8, categoryId: 1, name: "Фудзи", price: 58, image: image("1735210842902"), active: true, sortOrder: 8 },
  { id: 9, categoryId: 1, name: "Кани", price: 45, image: image("1735210873087"), active: true, sortOrder: 9 },
  { id: 10, categoryId: 1, name: "Прайм", price: 52, image: image("1735210905666"), active: true, sortOrder: 10 },
  { id: 11, categoryId: 1, name: "Спринг эби", price: 51, image: image("1735210940279"), active: true, sortOrder: 11 },
  { id: 12, categoryId: 1, name: "Лава с креветкой", price: 45, image: image("1735211020394"), active: true, sortOrder: 12 },
  { id: 13, categoryId: 1, name: "Калифорния с креветкой", price: 45, image: image("1735211053519"), active: true, sortOrder: 13 },
  { id: 14, categoryId: 1, name: "Восходящее солнце", price: 45, image: image("1735211092983"), active: true, sortOrder: 14 },
  { id: 15, categoryId: 1, name: "Токио", price: 57, image: image("1735211126462"), active: true, sortOrder: 15 },
  { id: 16, categoryId: 1, name: "Муракай маки", price: 44, image: image("1735211158116"), active: true, sortOrder: 16 },
  { id: 17, categoryId: 1, name: "Канада лайт", price: 48, image: image("1735211193649"), active: true, sortOrder: 17 },
  { id: 18, categoryId: 1, name: "Эби макура", price: 51, image: image("1735211267666"), active: true, sortOrder: 18 },
  { id: 19, categoryId: 1, name: "Аригато", price: 68, image: image("1744979952163"), active: true, sortOrder: 19 },
  { id: 20, categoryId: 1, name: "Онтарио", price: 57, image: image("1735211421810"), active: true, sortOrder: 20 },
  { id: 21, categoryId: 1, name: "Киото", price: 43, image: image("1744980054179"), active: true, sortOrder: 21 },
  { id: 22, categoryId: 1, name: "Хосомаки с угрем", price: 115, image: image("1744816664711"), active: true, sortOrder: 22 },
  { id: 23, categoryId: 1, name: "Хосомаки с лососем", price: 115, image: image("1744816799437"), active: true, sortOrder: 23 },
  { id: 24, categoryId: 1, name: "Хосомаки с креветкой", price: 115, image: image("1744816888736"), active: true, sortOrder: 24 },
  { id: 25, categoryId: 1, name: "Хосомаки с копченым лососем", price: 115, image: image("1744816964951"), active: true, sortOrder: 25 },
  { id: 26, categoryId: 1, name: "Унэби", price: 44, image: image("1744979730467"), active: true, sortOrder: 26 },
  { id: 27, categoryId: 1, name: "Чикен тортилья", price: 39, image: image("1744979854293"), active: true, sortOrder: 27 },
  { id: 28, categoryId: 1, name: "Хиоко", price: 42, image: image("1744979970941"), active: true, sortOrder: 28 },
  { id: 29, categoryId: 2, name: "Онигири с креветкой", price: 165, image: image("1736432465572"), active: true, sortOrder: 1 },
  { id: 30, categoryId: 2, name: "Онигири с лососем", price: 195, image: image("1736432486643"), active: true, sortOrder: 2 },
  { id: 31, categoryId: 3, name: "Фила сет", price: 1490, image: image("1737691810267"), active: true, sortOrder: 1 },
  { id: 32, categoryId: 3, name: "Асама сет", price: 1305, image: image("1744978606848"), active: true, sortOrder: 2 },
  { id: 33, categoryId: 3, name: "Ямато сет", price: 540, image: image("1744979152808"), active: true, sortOrder: 3 },
  { id: 34, categoryId: 3, name: "Тами сет", price: 620, image: image("1744979264784"), active: true, sortOrder: 4 },
  { id: 35, categoryId: 3, name: "Кимпу сет", price: 510, image: image("1744979349491"), active: true, sortOrder: 5 },
  { id: 36, categoryId: 4, name: "БУДЕТ ПОЗЖЕ", price: 125, image: image("1736432521226"), active: true, sortOrder: 1 },
  { id: 37, categoryId: 4, name: "Морс облепиха", price: 125, image: image("1736432543833"), active: true, sortOrder: 2 },
  { id: 38, categoryId: 4, name: "Морс брусника", price: 125, image: image("1736432560111"), active: true, sortOrder: 3 },
  { id: 39, categoryId: 4, name: "Фейхоа-пломбир", price: 175, image: image("1738210755050"), active: true, sortOrder: 4 },
  { id: 40, categoryId: 4, name: "Манго-персик", price: 175, image: image("1738210779874"), active: true, sortOrder: 5 },
  { id: 41, categoryId: 4, name: "БУДЕТ ПОЗЖЕ", price: 175, image: image("1738210795714"), active: true, sortOrder: 6 },
  { id: 42, categoryId: 4, name: "БУДЕТ ПОЗЖЕ", price: 175, image: image("1738210813400"), active: true, sortOrder: 7 },
  { id: 43, categoryId: 7, name: "Суширрито чикен", price: 145, image: image("1744980674274"), active: true, sortOrder: 1 },
  { id: 44, categoryId: 7, name: "Суширрито эби", price: 165, image: image("1744980700942"), active: true, sortOrder: 2 },
  { id: 45, categoryId: 7, name: "Суширрито с лососем", price: 195, image: image("1744980713550"), active: true, sortOrder: 3 },
  { id: 46, categoryId: 5, name: "Соевый соус", price: 16, image: image("1736432650205"), active: true, sortOrder: 1 },
  { id: 47, categoryId: 5, name: "Имбирь", price: 18, image: image("1736432677519"), active: true, sortOrder: 2 },
  { id: 48, categoryId: 5, name: "Васаби", price: 16, image: image("1736432695097"), active: true, sortOrder: 3 },
  { id: 49, categoryId: 5, name: "Палочки", price: 6, image: image("1736432710898"), active: true, sortOrder: 4 },
];

export const locations: PickupLocation[] = [
  {
    id: 1,
    name: "ДААНА СУШИ — Отуз-Адыр",
    address: "Ошская область, Кара-Суйский район, с. Отуз-Адыр, ул. Токтогула, дом 4",
    phone: "+996 (555) 506-447",
    hours: "10:00 - 21:00",
    opensAt: "10:00",
    latitude: 40.606046,
    longitude: 72.966095,
    active: true,
  },
];

export const promotions: Promotion[] = [
  { id: 1, title: "-15% имениннику", description: "Дарим именинникам скидку: за 3 дня до, в день рождения и 3 дня после! Пусть каждый ваш день будет наполнен радостью и приятными сюрпризами!", image: "/assets/promos/1734418347433.webp", active: true, sortOrder: 1 },
  { id: 2, title: "Последний час 20%", description: "Скидка 20% действует в последний час/полчаса работы на все роллы, представленные на витрине.", image: "/assets/promos/1766921524730.webp", active: true, sortOrder: 2 },
];
