"use client";

import {
  mdiAlertOutline,
  mdiArrowLeft,
  mdiCheck,
  mdiClose,
  mdiContentPaste,
  mdiHexagonMultipleOutline,
  mdiQrcodeScan,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CustomerNft, NftNetwork } from "../types";

export type RewardWithdrawalInput = {
  kind: "coins" | "nft";
  walletAddress: string;
  requestId?: string;
  amount?: number;
  nftId?: string;
};

type Props = {
  coins: number;
  coinNetwork: string;
  nfts: CustomerNft[];
  onClose: () => void;
  onSubmit: (input: RewardWithdrawalInput) => Promise<void>;
};

type WithdrawalStep = "form" | "scanner" | "confirm" | "success";
type BarcodeResult = { rawValue?: string };
type BarcodeDetectorInstance = { detect: (source: HTMLVideoElement) => Promise<BarcodeResult[]> };
type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorInstance;

const networkLabels: Record<NftNetwork, string> = {
  polygon: "Polygon",
  ethereum: "Ethereum",
  bsc: "BNB Smart Chain",
  solana: "Solana",
  ton: "TON",
};

export function walletAddressFromQr(value: string) {
  let candidate = value.trim();
  const scheme = candidate.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (scheme === "http" || scheme === "https") return "";

  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    candidate = candidate.replace(/^[a-z][a-z0-9+.-]*:(?:\/\/)?/i, "");
    candidate = candidate.split(/[?#]/, 1)[0] || "";
    candidate = candidate.split("/").filter(Boolean).at(-1) || "";
    candidate = candidate.split("@", 1)[0] || "";
  }
  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    return "";
  }
  return /^\S{16,200}$/.test(candidate) ? candidate : "";
}

function walletAddressIsValid(network: string, address: string) {
  const candidate = address.trim();
  if (["polygon", "ethereum", "bsc"].includes(network)) return /^0x[a-fA-F0-9]{40}$/.test(candidate);
  if (network === "solana") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(candidate);
  if (network === "ton") return /^(?:-1|0):[a-fA-F0-9]{64}$/.test(candidate) || /^(?:EQ|UQ)[A-Za-z0-9_-]{46}$/.test(candidate);
  return false;
}

export default function RewardsWithdrawalDialog({ coins, coinNetwork, nfts, onClose, onSubmit }: Props) {
  const availableNfts = useMemo(
    () => nfts.filter((nft) => nft.status === "owned" || nft.status === "failed"),
    [nfts],
  );
  const [step, setStep] = useState<WithdrawalStep>("form");
  const [kind, setKind] = useState<RewardWithdrawalInput["kind"] | null>(null);
  const [nftId, setNftId] = useState("");
  const [amount, setAmount] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scanBusyRef = useRef(false);
  const coinRequestIdRef = useRef("");

  useEffect(() => {
    coinRequestIdRef.current = "";
  }, [amount, kind, walletAddress]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) {
        if (step === "scanner" || step === "confirm") setStep("form");
        else onClose();
      }
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose, step, submitting]);

  useEffect(() => {
    if (step !== "scanner") return;
    let disposed = false;
    let frame = 0;
    let stream: MediaStream | null = null;
    let video: HTMLVideoElement | null = null;

    const start = async () => {
      const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
      if (!Detector || !navigator.mediaDevices?.getUserMedia) {
        setError("Сканирование QR не поддерживается этим браузером. Вставьте адрес вручную.");
        setStep("form");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (disposed || !videoRef.current) return;
        video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        const detector = new Detector({ formats: ["qr_code"] });
        const scan = async () => {
          if (disposed) return;
          if (!scanBusyRef.current && videoRef.current?.readyState === 4) {
            scanBusyRef.current = true;
            try {
              const [result] = await detector.detect(videoRef.current);
              if (result?.rawValue) {
                const address = walletAddressFromQr(result.rawValue);
                if (address) {
                  setWalletAddress(address);
                  setError("");
                  setStep("form");
                  return;
                }
                setError("В QR-коде не найден корректный адрес криптокошелька.");
              }
            } catch {
              // Камера может не распознать отдельный кадр во время фокусировки.
            } finally {
              scanBusyRef.current = false;
            }
          }
          frame = window.requestAnimationFrame(() => void scan());
        };
        frame = window.requestAnimationFrame(() => void scan());
      } catch {
        setError("Не удалось открыть камеру. Разрешите доступ или вставьте адрес вручную.");
        setStep("form");
      }
    };

    void start();
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      if (video) video.srcObject = null;
      scanBusyRef.current = false;
    };
  }, [step]);

  const selectedNft = availableNfts.find((nft) => nft.id === nftId);
  const parsedAmount = /^\d+$/.test(amount) ? Number(amount) : 0;
  const amountValid = kind !== "coins" || (parsedAmount >= 1 && parsedAmount <= coins);
  const selectedNetwork = kind === "coins" ? coinNetwork : selectedNft?.network || "";
  const addressValid = walletAddressIsValid(selectedNetwork, walletAddress);
  const canContinue = Boolean(kind) && amountValid && addressValid && (kind !== "nft" || Boolean(selectedNft));

  const chooseKind = (nextKind: RewardWithdrawalInput["kind"]) => {
    if ((nextKind === "coins" && coins <= 0) || (nextKind === "nft" && !availableNfts.length)) return;
    setKind(nextKind);
    setNftId(nextKind === "nft" ? availableNfts[0]?.id || "" : "");
    setAmount("");
    setError("");
  };

  const pasteAddress = async () => {
    try {
      const value = (await navigator.clipboard.readText()).trim();
      if (!value) throw new Error();
      setWalletAddress(value);
      setError("");
    } catch {
      setError("Не удалось прочитать буфер обмена. Вставьте адрес в поле вручную.");
    }
  };

  const submit = async () => {
    if (!kind || !canContinue || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit({
        kind,
        walletAddress: walletAddress.trim(),
        requestId: kind === "coins" ? (coinRequestIdRef.current ||= globalThis.crypto?.randomUUID?.() || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => { const value = Math.random() * 16 | 0; return (character === "x" ? value : (value & 0x3) | 0x8).toString(16); })) : undefined,
        amount: kind === "coins" ? parsedAmount : undefined,
        nftId: kind === "nft" ? selectedNft?.id : undefined,
      });
      setStep("success");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось оставить заявку");
    } finally {
      setSubmitting(false);
    }
  };

  const close = () => {
    if (!submitting) onClose();
  };

  return (
    <div className="overlay reward-withdrawal-overlay" role="dialog" aria-modal="true" aria-labelledby="reward-withdrawal-title">
      <button className="reward-withdrawal-dismiss" type="button" aria-label="Закрыть форму вывода" disabled={submitting} onClick={close} />
      <section className="reward-withdrawal-dialog">
        <button className="reward-withdrawal-close" type="button" aria-label="Закрыть" onClick={close} disabled={submitting}><Icon path={mdiClose} size={0.9} aria-hidden="true" /></button>

        {step === "scanner" && <div className="reward-withdrawal-scanner">
          <header><button type="button" aria-label="Вернуться к форме" onClick={() => setStep("form")}><Icon path={mdiArrowLeft} size={0.9} aria-hidden="true" /></button><h2 id="reward-withdrawal-title">Сканирование QR</h2><span /></header>
          <div className="reward-withdrawal-camera"><video ref={videoRef} muted playsInline /><span aria-hidden="true" /></div>
          <p>Наведите камеру на QR-код с адресом криптокошелька.</p>
          {error && <p className="reward-scanner-error" role="alert">{error}</p>}
        </div>}

        {step === "success" && <div className="reward-withdrawal-success">
          <span><Icon path={mdiCheck} size={1.3} aria-hidden="true" /></span>
          <h2 id="reward-withdrawal-title">Заявка принята</h2>
          <p>Мы проверим заявку и отправим награду на указанный криптокошелёк. Статус появится в истории операций.</p>
          <button type="button" className="reward-withdrawal-primary" onClick={onClose}>Готово</button>
        </div>}

        {step === "confirm" && <div className="reward-withdrawal-content">
          <header className="reward-withdrawal-heading"><button type="button" aria-label="Изменить данные" onClick={() => { setError(""); setStep("form"); }}><Icon path={mdiArrowLeft} size={0.9} aria-hidden="true" /></button><span><h2 id="reward-withdrawal-title">Подтверждение вывода</h2><p>Проверьте данные перед отправкой заявки</p></span></header>
          <dl className="reward-withdrawal-summary">
            <div><dt>Актив</dt><dd>{kind === "coins" ? "NAKTA Coin" : selectedNft?.name || "NFT"}</dd></div>
            <div><dt>Сумма</dt><dd>{kind === "coins" ? `${parsedAmount} NAKTA Coin` : "1 NFT"}</dd></div>
            <div><dt>Адрес кошелька</dt><dd title={walletAddress.trim()}>{walletAddress.trim()}</dd></div>
            {kind === "coins" && <div><dt>Сеть</dt><dd>{networkLabels[coinNetwork as NftNetwork] || coinNetwork}</dd></div>}
            {kind === "nft" && selectedNft && <div><dt>Сеть</dt><dd>{networkLabels[selectedNft.network] || selectedNft.network}</dd></div>}
          </dl>
          <div className="reward-withdrawal-warning"><span><Icon path={mdiAlertOutline} size={0.9} aria-hidden="true" /></span><p>Проверьте адрес кошелька внимательно. После отправки заявки изменить его нельзя.</p></div>
          {error && <p className="reward-withdrawal-error" role="alert">{error}</p>}
          <button type="button" className="reward-withdrawal-primary" disabled={submitting} onClick={() => void submit()}>{submitting ? "Отправляем заявку…" : "Подтвердить вывод"}</button>
          <button type="button" className="reward-withdrawal-secondary" disabled={submitting} onClick={() => { setError(""); setStep("form"); }}>Изменить данные</button>
        </div>}

        {step === "form" && <div className="reward-withdrawal-content">
          <h2 id="reward-withdrawal-title">Вывод награды</h2>
          <p className="reward-withdrawal-subtitle">Что хотите вывести?</p>
          <div className="reward-withdrawal-kinds">
            <button type="button" className={`reward-kind-card coin${kind === "coins" ? " selected" : ""}`} disabled={coins <= 0} aria-pressed={kind === "coins"} onClick={() => chooseKind("coins")}><span>NAKTA Coin</span><strong>{new Intl.NumberFormat("ru-RU").format(coins)}</strong></button>
            <button type="button" className={`reward-kind-card nft${kind === "nft" ? " selected" : ""}`} disabled={!availableNfts.length} aria-pressed={kind === "nft"} onClick={() => chooseKind("nft")}><span>NFT</span><strong>{availableNfts.length}</strong><i><Icon path={mdiHexagonMultipleOutline} size={1} aria-hidden="true" /></i></button>
          </div>

          {kind === "nft" && availableNfts.length > 1 && <fieldset className="reward-nft-selector"><legend>Выберите NFT</legend>{availableNfts.map((nft) => { const inputId = `withdrawal-nft-${nft.id}`; return <label htmlFor={inputId} className={nft.id === nftId ? "selected" : ""} key={nft.id}><input id={inputId} aria-label={`${nft.name}, сеть ${networkLabels[nft.network] || nft.network}`} type="radio" name="withdrawalNft" value={nft.id} checked={nft.id === nftId} onChange={() => setNftId(nft.id)} /><span><b>{nft.name}</b><small>{networkLabels[nft.network] || nft.network}</small></span></label>; })}</fieldset>}

          {kind && <div className="reward-withdrawal-form">
            {kind === "coins" ? <label>Количество NAKTA Coin<input type="text" inputMode="numeric" autoComplete="off" maxLength={10} value={amount} placeholder={`От 1 до ${coins}`} onChange={(event) => { setAmount(event.target.value.replace(/\D/g, "")); setError(""); }} />{amount && !amountValid && <small className="invalid">Введите количество от 1 до {coins}</small>}</label> : <p className="reward-withdrawal-selection">К выводу: {selectedNft?.name || "NFT"}{selectedNft ? ` · ${networkLabels[selectedNft.network] || selectedNft.network}` : ""}</p>}
            <label>Адрес криптокошелька<span className="reward-wallet-field"><input type="text" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} minLength={16} maxLength={200} value={walletAddress} placeholder="Введите адрес кошелька" onChange={(event) => { setWalletAddress(event.target.value); setError(""); }} /><button type="button" title="Вставить адрес" aria-label="Вставить адрес из буфера" onClick={() => void pasteAddress()}><Icon path={mdiContentPaste} size={0.85} aria-hidden="true" /></button><button type="button" title="Сканировать QR" aria-label="Сканировать QR-код кошелька" onClick={() => { setError(""); setStep("scanner"); }}><Icon path={mdiQrcodeScan} size={0.9} aria-hidden="true" /></button></span>{walletAddress && !addressValid && <small className="invalid">Проверьте адрес для сети {networkLabels[selectedNetwork as NftNetwork] || selectedNetwork}.</small>}</label>
            <p className="reward-withdrawal-hint">Введите адрес вручную или отсканируйте QR-код. После отправки заявки адрес изменить нельзя.</p>
            {error && <p className="reward-withdrawal-error" role="alert">{error}</p>}
            <button type="button" className="reward-withdrawal-primary" disabled={!canContinue} onClick={() => { setError(""); setStep("confirm"); }}>Продолжить</button>
          </div>}
        </div>}
      </section>
    </div>
  );
}
