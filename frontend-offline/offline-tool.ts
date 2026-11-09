import { createOfflineDraw, parseOfflineRoster, type OfflineParticipant } from "../lib/offline-crypto";

const rosterInput = document.querySelector<HTMLInputElement>("#roster")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const error = document.querySelector<HTMLParagraphElement>("#error")!;
const generate = document.querySelector<HTMLButtonElement>("#generate")!;
const downloads = document.querySelector<HTMLDivElement>("#downloads")!;
const encrypted = document.querySelector<HTMLButtonElement>("#encrypted")!;
const codes = document.querySelector<HTMLButtonElement>("#codes")!;

let participants: OfflineParticipant[] = [];
let result: Awaited<ReturnType<typeof createOfflineDraw>> | undefined;

function showError(message: string) {
  error.textContent = message;
  error.hidden = !message;
}

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

rosterInput.addEventListener("change", async () => {
  const file = rosterInput.files?.[0];
  participants = [];
  generate.disabled = true;
  status.textContent = "";
  showError("");
  if (!file) return;

  try {
    if (file.size > 32_768) throw new Error("A lista é maior do que o esperado. Exporte o JSON novamente.");
    const content: unknown = JSON.parse(await file.text());
    const roster = parseOfflineRoster(content);
    if (rosterInput.files?.[0] !== file) return;
    participants = roster;
    status.textContent = `${roster.length} participantes carregados.`;
    generate.disabled = false;
  } catch (cause) {
    if (rosterInput.files?.[0] === file) {
      showError(cause instanceof SyntaxError ? "O arquivo não é um JSON válido." : (cause as Error).message);
    }
  }
});

generate.addEventListener("click", async () => {
  if (generate.disabled || !participants.length || result) return;
  showError("");
  generate.disabled = true;
  rosterInput.disabled = true;
  status.textContent = "Preparando os códigos e o arquivo criptografado…";
  try {
    if (!window.crypto?.subtle) {
      throw new Error("Abra o arquivo baixado em uma versão recente do Edge, Chrome ou Firefox.");
    }
    result = await createOfflineDraw(participants);
    status.textContent = `Sorteio concluído para ${participants.length} participantes.`;
    downloads.hidden = false;
    encrypted.focus();
  } catch (cause) {
    status.textContent = "";
    showError(cause instanceof Error ? cause.message : "Não foi possível preparar o sorteio.");
    generate.disabled = false;
    rosterInput.disabled = false;
  }
});

encrypted.addEventListener("click", () => {
  if (!result) return;
  download("sorteio-criptografado-2026.json", JSON.stringify(result.draw, null, 2), "application/json");
});

codes.addEventListener("click", () => {
  if (!result) return;
  const rows = result.distribution.flatMap(({ name, nickname, code }) => [
    nickname ? `${name} (${nickname})` : name,
    code,
    "",
  ]);
  download("codigos-amigo-secreto-2026.txt", [
    "Amigo Secreto 2026",
    "Envie a cada pessoa apenas o código abaixo do nome dela.",
    "Site https://kuromorioficial.github.io/amigo-secreto/",
    "",
    ...rows,
  ].join("\r\n"), "text/plain;charset=utf-8");
});
