"use client";

import { useAdminLanguage } from "./i18n";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useAdminAccess } from "./AdminAccess";
import AdminDialog from "./AdminDialog";
import { type AdminListRequest, Pagination, usePagedAdminList } from "./usePagedAdminList";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui";

export type RewardSettings = { coinNetwork: string; nftRewardEveryOrders: number; nftRewardName: string; nftRewardImage: string; nftRewardDescription: string; nftRewardNetwork: string; nftContractAddress: string; nftMetadataUri: string };
export const defaultRewards: RewardSettings = { coinNetwork: "polygon", nftRewardEveryOrders: 0, nftRewardName: "NFT DAANA", nftRewardImage: "", nftRewardDescription: "", nftRewardNetwork: "polygon", nftContractAddress: "", nftMetadataUri: "" };
type Asset = "coin" | "nft";
type Status = "owned" | "pending" | "submitted" | "withdrawn" | "failed" | "cancelled";
type Withdrawal = { id: string; amount?: number; name?: string; phone: string; customerName?: string | null; network: string; walletAddress: string | null; status: Status; txHash?: string | null; tokenId?: string | null; error?: string | null; withdrawalError?: string | null; createdAt: string; withdrawalRequestedAt?: string | null };
type Program = { enabled: boolean; everyOrders: number; name: string; image: string; description: string; network: string; contractAddress: string; metadataUri: string; coinNetwork: string };
type Overview = { program: Program; metrics: { rewardedProducts: number; issuedCoins: number; availableCoins: number; coinTransactions: number; pendingCoinWithdrawals: number; submittedCoinWithdrawals: number; nftsTotal: number; nftStatuses: Record<string, number> }; transferProviderConfigured: boolean };
type QueueAction = { status: "submitted" | "withdrawn" | "failed"; txHash: string; tokenId: string; reason: string };
const statusLabels: Record<Status, string> = { owned: "Доступен клиенту", pending: "Ожидает", submitted: "В обработке", withdrawn: "Выведено", failed: "Отклонено", cancelled: "Отменено клиентом" };
const networks = { polygon: "Polygon", ethereum: "Ethereum", bsc: "BNB Smart Chain", solana: "Solana", ton: "TON" };

const toSettings = (program: Program): RewardSettings => ({ coinNetwork: program.coinNetwork, nftRewardEveryOrders: program.everyOrders, nftRewardName: program.name, nftRewardImage: program.image, nftRewardDescription: program.description, nftRewardNetwork: program.network, nftContractAddress: program.contractAddress, nftMetadataUri: program.metadataUri });
const badgeVariant = (status: Status) => status === "withdrawn" ? "success" as const : status === "pending" ? "warning" as const : status === "failed" ? "destructive" as const : "secondary" as const;

function WithdrawalQueue({ request, refreshKey, asset, onChanged }: { request: AdminListRequest; refreshKey: number; asset: Asset; onChanged: () => Promise<void> }) {
  const { t, formatNumber, formatDate } = useAdminLanguage();
  const number = (value?: number) => formatNumber(value || 0); const date = (value?: string | null) => value ? formatDate(value, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

  const assetName = (asset: Asset, item: Withdrawal) => asset === "coin" ? `${number(item.amount)} DAANA Coin` : `NFT «${item.name || t("Награда")}»`;
  const { can } = useAdminAccess();
  const [status, setStatus] = useState("pending");
  const [selected, setSelected] = useState<Withdrawal | null>(null);
  const [action, setAction] = useState<QueueAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [detailNotice, setDetailNotice] = useState("");
  const pending = useRef(false);
  const endpoint = asset === "coin" ? "coin-withdrawals" : "nft-withdrawals";
  const list = usePagedAdminList<Withdrawal>(request, endpoint, status === "all" ? "" : new URLSearchParams({ status }).toString(), refreshKey, 25);
  const close = () => { if (!pending.current) { setSelected(null); setAction(null); setError(""); setDetailNotice(""); } };
  const begin = (next: QueueAction["status"]) => {
    if (!selected || pending.current || !can("loyalty.edit")) return;
    setError(""); setDetailNotice(""); setAction({ status: next, txHash: selected.txHash || "", tokenId: selected.tokenId || "", reason: "" });
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !action || pending.current || !can("loyalty.edit")) return;
    if (action.status === "withdrawn" && !action.txHash.trim()) { setError("Укажите хеш фактически выполненного перевода."); return; }
    if (action.status === "failed" && !action.reason.trim()) { setError("Укажите причину отклонения. Её увидит клиент."); return; }
    pending.current = true; setBusy(true); setError("");
    try {
      const body: Record<string, string> = { status: action.status, expectedStatus: selected.status };
      if (action.status === "withdrawn") { body.txHash = action.txHash.trim(); if (asset === "nft" && action.tokenId.trim()) body.tokenId = action.tokenId.trim(); }
      if (action.status === "failed") body.error = action.reason.trim();
      await request(`${endpoint}/${encodeURIComponent(selected.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setSelected(null); setAction(null); setNotice(action.status === "submitted" ? "Заявка взята в обработку. Теперь выполните перевод." : action.status === "withdrawn" ? "Вывод завершён. Хеш перевода сохранён." : "Заявка отклонена.");
      await Promise.all([list.reload(), onChanged()]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось изменить заявку. Обновите список и повторите действие."); }
    finally { pending.current = false; setBusy(false); }
  };
  const copyWallet = async () => {
    if (!selected?.walletAddress) return;
    try { await navigator.clipboard.writeText(selected.walletAddress); setDetailNotice("Адрес кошелька скопирован."); }
    catch { setDetailNotice("Не удалось скопировать автоматически. Выделите и скопируйте адрес кошелька."); }
  };
  return <Card><CardHeader><CardTitle>{asset === "coin" ? t("Заявки DAANA Coin") : t("NFT и заявки на вывод")}</CardTitle><CardDescription>{t("Возьмите заявку в обработку, выполните перевод и сохраните подтверждение.")}</CardDescription></CardHeader><CardContent>
    {notice && <div className="admin-success banner" role="status">{t(notice)}</div>}
    {t(list.error) && <div className="admin-error banner" role="alert">{t(list.error)}<Button onClick={() => void list.reload()}>{t("Повторить")}</Button></div>}
    {!selected && error && <div className="admin-error banner" role="alert">{t(error)}</div>}
    <div className="loyalty-queue-toolbar"><label>{t("Статус")}<select value={status} onChange={(event) => { setStatus(event.target.value); list.setPage(0); }}><option value="all">{t("Все статусы")}</option><option value="pending">{t("Ожидают обработки")}</option><option value="submitted">{t("В обработке")}</option><option value="withdrawn">{t("Выведены")}</option><option value="failed">{t("Отклонены")}</option>{asset === "coin" ? <option value="cancelled">{t("Отменены клиентом")}</option> : <option value="owned">{t("Доступны клиентам")}</option>}</select></label><span role="status">{list.loading ? t("Обновляем…") : t("Найдено: {v0}", { v0: list.total })}</span></div>
    {list.items.length ? <Table><TableHeader><TableRow><TableHead>{t("Клиент")}</TableHead><TableHead>{t("Награда")}</TableHead><TableHead>{t("Сеть")}</TableHead><TableHead>{t("Статус")}</TableHead><TableHead>{t("Создано")}</TableHead><TableHead><span className="sr-only">{t("Действия")}</span></TableHead></TableRow></TableHeader><TableBody>{list.items.map((item) => <TableRow key={item.id}><TableCell><strong>{item.customerName || t("Без имени")}</strong><small className="staff-contact">{item.phone}</small></TableCell><TableCell>{assetName(asset, item)}</TableCell><TableCell>{networks[item.network as keyof typeof networks] || item.network || t("Не указана")}</TableCell><TableCell><Badge variant={badgeVariant(item.status)}>{t(statusLabels[item.status])}</Badge></TableCell><TableCell>{date(item.withdrawalRequestedAt || item.createdAt)}</TableCell><TableCell><Button onClick={() => { setSelected(item); setAction(null); setError(""); setDetailNotice(""); }}>{t("Открыть")}</Button></TableCell></TableRow>)}</TableBody></Table> : !list.loading && !t(list.error) ? <EmptyState title={t("Заявок нет")}><p>{t("Здесь появятся заявки клиентов с выбранным статусом.")}</p></EmptyState> : null}
    <Pagination page={list.page} total={list.total} limit={list.limit} loading={list.loading} onPage={list.setPage} />
    {selected && <AdminDialog title={assetName(asset, selected)} description={`${selected.customerName || t("Клиент")} · ${selected.phone}`} onClose={close} busy={busy} className="admin-action-dialog loyalty-withdrawal-dialog"><form onSubmit={submit}>
      <div className="loyalty-withdrawal-summary"><Badge variant={badgeVariant(selected.status)}>{t(statusLabels[selected.status])}</Badge><span>{date(selected.withdrawalRequestedAt || selected.createdAt)}</span></div>
      <dl className="loyalty-withdrawal-details"><div><dt>{t("Сеть перевода")}</dt><dd>{networks[selected.network as keyof typeof networks] || selected.network || t("Не указана")}</dd></div><div><dt>{t("Кошелёк клиента")}</dt><dd className="loyalty-wallet">{selected.walletAddress || t("Клиент не указал кошелёк")}</dd>{selected.walletAddress && <Button type="button" variant="ghost" onClick={() => void copyWallet()}>{t("Копировать адрес")}</Button>}</div>{selected.txHash && <div><dt>{t("Подтверждение перевода")}</dt><dd className="loyalty-wallet">{selected.txHash}</dd></div>}{selected.tokenId && <div><dt>{t("Номер NFT в сети")}</dt><dd>{selected.tokenId}</dd></div>}{(selected.error || selected.withdrawalError) && <div><dt>{t("Причина отклонения")}</dt><dd>{selected.error || selected.withdrawalError}</dd></div>}</dl>
      {detailNotice && <p className="admin-info" role="status">{t(detailNotice)}</p>}{error && <div className="admin-error" role="alert">{t(error)}</div>}
      {action?.status === "submitted" && <div className="admin-claim-warning"><strong>{t("Проверьте сеть и адрес кошелька")}</strong><p>{t("После подтверждения клиент не сможет отменить заявку. Завершайте вывод только после фактического перевода.")}</p></div>}
      {action?.status === "withdrawn" && <><label>{t("Хеш выполненной транзакции")}<input required maxLength={200} value={action.txHash} disabled={busy} onChange={(event) => setAction({ ...action, txHash: event.target.value })} placeholder={t("Подтверждение в сети")} /></label>{asset === "nft" && <details className="admin-additional-fields"><summary>{t("Дополнительно")}</summary><label>{t("Номер NFT в сети (необязательно)")}<input maxLength={160} value={action.tokenId} disabled={busy} onChange={(event) => setAction({ ...action, tokenId: event.target.value })} /></label></details>}</>}
      {action?.status === "failed" && <label>{t("Причина отклонения")}<textarea required maxLength={2000} disabled={busy} value={action.reason} onChange={(event) => setAction({ ...action, reason: event.target.value })} placeholder={t("Объясните причину клиенту")} /></label>}
      <div className="editor-actions"><Button type="button" data-dialog-dismiss disabled={busy} onClick={close}>{t("Закрыть")}</Button>{!action && can("loyalty.edit") && selected.status === "pending" && <><Button type="button" variant="destructive" onClick={() => begin("failed")}>{t("Отклонить")}</Button><Button type="button" variant="default" disabled={!selected.walletAddress} onClick={() => begin("submitted")}>{t("Взять в обработку")}</Button></>}{!action && can("loyalty.edit") && selected.status === "submitted" && <Button type="button" variant="default" onClick={() => begin("withdrawn")}>{t("Завершить вывод")}</Button>}{action && <Button type="submit" variant={action.status === "failed" ? "destructive" : "default"} disabled={busy}>{busy ? t("Сохраняем…") : action.status === "submitted" ? t("Подтвердить обработку") : action.status === "withdrawn" ? t("Подтвердить вывод") : t("Отклонить заявку")}</Button>}</div>
    </form></AdminDialog>}
  </CardContent></Card>;
}

export default function LoyaltyWorkspace({ request, refreshKey }: { request: AdminListRequest; refreshKey: number }) {
  const { t, formatNumber } = useAdminLanguage();
  const number = (value?: number) => formatNumber(value || 0);

  const { can } = useAdminAccess();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tab, setTab] = useState<"coin" | "nft" | "program">("coin");
  const [draft, setDraft] = useState<RewardSettings | null>(null);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);
  const savePending = useRef(false);
  const load = useCallback(async () => {
    const current = ++generation.current;
    try { const result = await request<Overview>("loyalty/overview"); if (current === generation.current) { setOverview(result); setError(""); } }
    catch (reason) { if (current === generation.current) setError(reason instanceof Error ? reason.message : "Не удалось загрузить программу наград."); }
  }, [request]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => { clearTimeout(timer); generation.current += 1; }; }, [load, refreshKey]);
  const saveProgram = async (event: FormEvent) => {
    event.preventDefault(); if (!draft || savePending.current || !can("loyalty.edit")) return;
    if (!draft.nftRewardName.trim() || !Number.isSafeInteger(draft.nftRewardEveryOrders) || draft.nftRewardEveryOrders < 0 || draft.nftRewardEveryOrders > 10000) { setFormError("Укажите название NFT и целое число заказов от 0 до 10000."); return; }
    savePending.current = true; setSaving(true); setFormError("");
    try { await request("settings/rewards", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: { ...draft, nftRewardName: draft.nftRewardName.trim() } }) }); setDraft(null); setNotice("Программа наград сохранена."); await load(); }
    catch (reason) { setFormError(reason instanceof Error ? reason.message : "Не удалось сохранить программу."); }
    finally { savePending.current = false; setSaving(false); }
  };
  return <div className="loyalty-workspace">
    {error && <div className="admin-error" role="alert">{t(error)}<Button onClick={() => void load()}>{t("Повторить")}</Button></div>}{notice && <div className="admin-success" role="status">{t(notice)}</div>}
    <div className="stat-grid">{[[t("Баланс Coin у клиентов"), overview?.metrics.availableCoins], [t("Coin: ожидают обработки"), overview?.metrics.pendingCoinWithdrawals], [t("NFT: ожидают обработки"), overview?.metrics.nftStatuses.pending], [t("NFT выдано всего"), overview?.metrics.nftsTotal]].map(([title, value]) => <Card key={String(title)}><CardHeader><CardDescription>{String(title)}</CardDescription><strong className="admin-stat-value">{value === undefined ? "…" : number(Number(value))}</strong></CardHeader></Card>)}</div>
    <nav className="admin-tabs" aria-label={t("Программа наград")}><Button aria-current={tab === "coin" ? "page" : undefined} onClick={() => setTab("coin")}>DAANA Coin</Button><Button aria-current={tab === "nft" ? "page" : undefined} onClick={() => setTab("nft")}>NFT</Button><Button aria-current={tab === "program" ? "page" : undefined} onClick={() => setTab("program")}>{t("Настройки программы")}</Button></nav>
    {tab !== "program" ? <WithdrawalQueue key={tab} request={request} refreshKey={refreshKey} asset={tab} onChanged={load} /> : overview ? <Card><CardHeader><CardTitle>{t("Программа наград")}</CardTitle><CardDescription>{t("Награды за завершённые заказы и сети перевода.")}</CardDescription></CardHeader><CardContent><dl className="loyalty-program-summary"><div><dt>{t("Автоматическая выдача NFT")}</dt><dd>{overview.program.enabled ? t("Каждые {v0} завершённых заказов", { v0: number(overview.program.everyOrders) }) : t("Выключена")}</dd></div><div><dt>{t("Название награды")}</dt><dd>{overview.program.name}</dd></div><div><dt>{t("Сеть DAANA Coin")}</dt><dd>{networks[overview.program.coinNetwork as keyof typeof networks] || overview.program.coinNetwork}</dd></div><div><dt>{t("Сеть NFT")}</dt><dd>{networks[overview.program.network as keyof typeof networks] || overview.program.network}</dd></div><div><dt>{t("Товаров с наградой Coin")}</dt><dd>{number(overview.metrics.rewardedProducts)}</dd></div><div><dt>{t("Начислено Coin за заказы")}</dt><dd>{number(overview.metrics.issuedCoins)}</dd></div></dl>{can("loyalty.edit") && <Button variant="default" onClick={() => { setDraft(toSettings(overview.program)); setFormError(""); }}>{t("Редактировать программу")}</Button>}<p className="admin-muted">{overview.transferProviderConfigured ? t("Провайдер отправки NFT подключён.") : t("Переводы выполняются вручную. После перевода сохраните хеш транзакции.")}</p></CardContent></Card> : <Card><CardContent><p className="admin-muted" role="status">{t("Загружаем программу наград…")}</p></CardContent></Card>}
    {draft && <AdminDialog title={t("Настройки программы наград")} description={t("Изменения применяются к новым начислениям. Уже выданные награды сохраняются.")} busy={saving} onClose={() => { if (!savePending.current) setDraft(null); }} className="admin-editor-dialog"><form onSubmit={saveProgram}>{formError && <div className="admin-error banner" role="alert">{t(formError)}</div>}<fieldset disabled={saving || !can("loyalty.edit")}><div className="editor-grid"><label>{t("Сеть DAANA Coin")}<select value={draft.coinNetwork} onChange={(event) => setDraft({ ...draft, coinNetwork: event.target.value })}>{Object.entries(networks).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label><label>{t("Выдавать NFT каждые N заказов")}<input type="number" min={0} max={10000} step={1} required value={draft.nftRewardEveryOrders} onChange={(event) => setDraft({ ...draft, nftRewardEveryOrders: Number(event.target.value) })} /><small>{t("0 — автоматическая выдача выключена.")}</small></label><label>{t("Название NFT")}<input required maxLength={200} value={draft.nftRewardName} onChange={(event) => setDraft({ ...draft, nftRewardName: event.target.value })} /></label><label>{t("Сеть NFT")}<select value={draft.nftRewardNetwork} onChange={(event) => setDraft({ ...draft, nftRewardNetwork: event.target.value })}>{Object.entries(networks).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label><label className="wide-field">{t("Изображение NFT")}<input maxLength={2000} value={draft.nftRewardImage} onChange={(event) => setDraft({ ...draft, nftRewardImage: event.target.value })} placeholder={t("Ссылка на изображение")} /></label><label className="wide-field">{t("Описание награды")}<textarea maxLength={2000} value={draft.nftRewardDescription} onChange={(event) => setDraft({ ...draft, nftRewardDescription: event.target.value })} /></label></div><details className="admin-additional-fields"><summary>{t("Дополнительно")}</summary><div className="editor-grid"><label className="wide-field">{t("Адрес контракта NFT")}<input value={draft.nftContractAddress} maxLength={2000} onChange={(event) => setDraft({ ...draft, nftContractAddress: event.target.value })} /></label><label className="wide-field">{t("Ссылка на описание NFT в сети")}<input value={draft.nftMetadataUri} maxLength={2000} onChange={(event) => setDraft({ ...draft, nftMetadataUri: event.target.value })} placeholder="ipfs://…" /></label></div></details></fieldset><div className="editor-actions"><Button type="button" data-dialog-dismiss disabled={saving} onClick={() => setDraft(null)}>{t("Отменить")}</Button><Button variant="default" disabled={saving}>{saving ? t("Сохраняем…") : t("Сохранить программу")}</Button></div></form></AdminDialog>}
  </div>;
}
