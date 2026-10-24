import { useEffect } from 'react'
import type { ManualAssetInput } from '@shared/assets'
import type { VehicleInput } from '@shared/vehicles'
import type { Plan } from '@shared/plan'
import type { CropKey, FarmEntryInput, FarmSeasonInput, HoldingCosts } from '@shared/farm'
import type { LoanInput, LoanPayment } from '@shared/loans'
import type { AiFeatures, ChatEvent, ChatTurn, SpendCategory } from '@shared/ai'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Basis } from '@shared/research'
import type { Screen } from '@shared/screener'
import type {
  ApiResult,
  EpfInput,
  ImportRequest,
  ManualTxnInput,
  NpsAccountInput,
  NpsHoldingInput,
  Person,
  PolicyInput,
  Targets,
  Theme
} from '@shared/types'

export async function unwrap<T>(p: Promise<ApiResult<T>>): Promise<T> {
  const r = await p
  if (!r.ok) throw new Error(r.error)
  return r.data
}

const api = () => window.api

export const usePersons = () => useQuery({ queryKey: ['persons'], queryFn: () => unwrap(api().listPersons()) })
export const useAccounts = () => useQuery({ queryKey: ['accounts'], queryFn: () => unwrap(api().listAccounts()) })
export const useHoldings = (personId?: number) =>
  useQuery({ queryKey: ['holdings', personId ?? 'all'], queryFn: () => unwrap(api().listHoldings(personId)) })
export const useTransactions = (personId?: number) =>
  useQuery({
    queryKey: ['transactions', personId ?? 'all'],
    queryFn: () => unwrap(api().listTransactions({ personId, limit: 1000 }))
  })
export const useImports = () => useQuery({ queryKey: ['imports'], queryFn: () => unwrap(api().listImports()) })

/** Any write can change holdings, accounts and history, so refresh everything. */
function useInvalidateAll() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries()
}

export function useSetBuyPrice() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (input: {
      personId: number
      accountId: number
      instrumentId: number
      avgCost: number | null
      heldSince?: string | null
    }) => unwrap(api().setBuyPrice(input)),
    onSuccess: invalidate
  })
}

export function useRunImport() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: (req: ImportRequest) => unwrap(api().runImport(req)), onSuccess: invalidate })
}
export function useUndoImport() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: (id: number) => unwrap(api().undoImport(id)), onSuccess: invalidate })
}
export function useAddManual() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (input: ManualTxnInput) => unwrap(api().addManualTransaction(input)),
    onSuccess: invalidate
  })
}
export function useDeleteTransaction() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: (id: number) => unwrap(api().deleteTransaction(id)), onSuccess: invalidate })
}
export function useSavePerson() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (p: Omit<Person, 'id'> & { id?: number }) => unwrap(api().savePerson(p)),
    onSuccess: invalidate
  })
}

// ---------------- market data, analytics, manual assets ----------------

export const useMarketStatus = () =>
  useQuery({ queryKey: ['marketStatus'], queryFn: () => unwrap(api().getMarketStatus()), refetchInterval: 15_000 })
export const useFx = () => useQuery({ queryKey: ['fx'], queryFn: () => unwrap(api().getFx()) })
export const usePriceHistory = (instrumentId: number | null, range: '1mo' | '6mo' | '1y' | '5y') =>
  useQuery({
    queryKey: ['history', instrumentId, range],
    queryFn: () => unwrap(api().getPriceHistory(instrumentId!, range)),
    enabled: instrumentId !== null,
    staleTime: 10 * 60_000,
    retry: false
  })
export const useDividends = (personId?: number) =>
  useQuery({ queryKey: ['dividends', personId ?? 'all'], queryFn: () => unwrap(api().listDividends(personId)) })
export const useExposure = (personId?: number) =>
  useQuery({ queryKey: ['exposure', personId ?? 'all'], queryFn: () => unwrap(api().getExposure(personId)) })
export const useEpf = () => useQuery({ queryKey: ['epf'], queryFn: () => unwrap(api().listEpf()) })
export const usePolicies = () => useQuery({ queryKey: ['policies'], queryFn: () => unwrap(api().listPolicies()) })
export const useNpsSchemes = (enabled: boolean) =>
  useQuery({ queryKey: ['npsSchemes'], queryFn: () => unwrap(api().listNpsSchemes()), enabled, staleTime: Infinity })

/** Keeps every screen current: new prices from the main process refresh all data except chart history. */
export function useMarketSubscription() {
  const qc = useQueryClient()
  useEffect(
    () =>
      api().onMarketUpdate(() => {
        void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'history' && q.queryKey[0] !== 'npsSchemes' })
      }),
    [qc]
  )
}

function useWrite<A extends unknown[], R>(fn: (...a: A) => Promise<ApiResult<R>>) {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: (args: A) => unwrap(fn(...args)), onSuccess: invalidate })
}

export const useRefreshMarket = () => useWrite(() => api().refreshMarket())
export const useSaveEpf = () => useWrite((input: EpfInput) => api().saveEpf(input))
export const useAddEpfEntry = () =>
  useWrite((id: number, date: string, balance: number) => api().addEpfEntry(id, date, balance))
export const useDeleteEpfEntry = () => useWrite((id: number, date: string) => api().deleteEpfEntry(id, date))
export const useSavePolicy = () => useWrite((input: PolicyInput) => api().savePolicy(input))
export const useDeletePolicy = () => useWrite((id: number) => api().deletePolicy(id))
export const useAddNps = () => useWrite((input: NpsHoldingInput) => api().addNpsHolding(input))
export const useAddNpsAccount = () => useWrite((input: NpsAccountInput) => api().addNpsAccount(input))
export const useRemoveHolding = () =>
  useWrite((accountId: number, instrumentId: number) => api().removeHolding(accountId, instrumentId))

// ---------------- other assets, analysis ----------------

export const useManualAssets = () =>
  useQuery({ queryKey: ['manualAssets'], queryFn: () => unwrap(api().listManualAssets()) })
export const useMetalPrices = () =>
  useQuery({ queryKey: ['metalPrices'], queryFn: () => unwrap(api().getMetalPrices()) })
export const useAnalysis = (personId?: number) =>
  useQuery({ queryKey: ['analysis', personId ?? 'all'], queryFn: () => unwrap(api().getAnalysis(personId)) })
export const useSparklines = (ids: number[]) =>
  useQuery({
    queryKey: ['sparklines', ids.join(',')],
    queryFn: () => unwrap(api().getSparklines(ids)),
    enabled: ids.length > 0,
    staleTime: 10 * 60_000
  })

export const usePerformance = (personId?: number) =>
  useQuery({ queryKey: ['performance', personId ?? 'all'], queryFn: () => unwrap(api().getPerformance(personId)) })

export const useTax = (personId?: number) =>
  useQuery({ queryKey: ['tax', personId ?? 'all'], queryFn: () => unwrap(api().getTax(personId)) })

export const useFunds = (personId?: number) =>
  useQuery({ queryKey: ['funds', personId ?? 'all'], queryFn: () => unwrap(api().getFunds(personId)) })

export const useRisk = (personId?: number) =>
  useQuery({ queryKey: ['risk', personId ?? 'all'], queryFn: () => unwrap(api().getRisk(personId)) })
export function useSetRiskFreeRate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (rate: number) => unwrap(api().setRiskFreeRate(rate)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['risk'] })
  })
}

export const useRebalance = (personId: number | undefined, opts: { newMoneyInr: number; allowSells: boolean }) =>
  useQuery({
    queryKey: ['rebalance', personId ?? 'all', opts.newMoneyInr, opts.allowSells],
    queryFn: () => unwrap(api().getRebalance(personId, opts)),
    placeholderData: (prev) => prev
  })
export function useSetTargets() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { personId: number | null; targets: Targets | null }) =>
      unwrap(api().setTargets(v.personId, v.targets)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rebalance'] })
  })
}

export const useHealth = (personId?: number) =>
  useQuery({ queryKey: ['health', personId ?? 'all'], queryFn: () => unwrap(api().getHealth(personId)) })
export const useTheme = () =>
  useQuery({ queryKey: ['theme'], queryFn: () => unwrap(api().getTheme()), staleTime: Infinity })
export function useSetTheme() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (t: Theme) => unwrap(api().setTheme(t)),
    onSuccess: (_d, t) => qc.setQueryData(['theme'], t)
  })
}

export const useBenchmarks = (since?: string) =>
  useQuery({
    queryKey: ['benchmarks', since ?? 'all'],
    queryFn: () => unwrap(api().listBenchmarks(since)),
    staleTime: 60 * 60_000
  })

export const useSaveManual = () => useWrite((input: ManualAssetInput) => api().saveManualAsset(input))
export const useDeleteManual = () => useWrite((id: number) => api().deleteManualAsset(id))
export const useAddManualEntry = () =>
  useWrite((id: number, date: string, value: number) => api().addManualEntry(id, date, value))
export const useDeleteManualEntry = () => useWrite((id: number, date: string) => api().deleteManualEntry(id, date))
export const useSetGoldPremium = () => useWrite((pct: number) => api().setGoldPremium(pct))

// ---------------- fund house disclosures ----------------

export const useDisclosureStatus = () =>
  useQuery({ queryKey: ['disclosures'], queryFn: () => unwrap(api().getDisclosureStatus()) })
export const useSyncDisclosures = () => useWrite((force?: boolean) => api().syncDisclosures(force))
export const openExternal = (url: string) => unwrap(api().openExternal(url))

// ---------------- property ----------------

export const useProperties = (personId?: number) =>
  useQuery({ queryKey: ['properties', personId ?? 'all'], queryFn: () => unwrap(api().getProperties(personId)) })
export const useHousingCities = (enabled = true) =>
  useQuery({
    queryKey: ['housingCities'],
    queryFn: () => unwrap(api().getHousingCities()),
    enabled,
    staleTime: Infinity,
    retry: 1
  })

// ---------------- vehicles and documents ----------------

export const useVehicles = (personId?: number) =>
  useQuery({ queryKey: ['vehicles', personId ?? 'all'], queryFn: () => unwrap(api().listVehicles(personId)) })
export const useSaveVehicle = () => useWrite((input: VehicleInput) => api().saveVehicle(input))
export const useDeleteVehicle = () => useWrite((id: number) => api().deleteVehicle(id))
export const useAddVehicleDocument = () =>
  useWrite((vehicleId: number, kind: string, filePath: string) => api().addVehicleDocument(vehicleId, kind, filePath))
export const useDeleteDocument = () => useWrite((id: number) => api().deleteDocument(id))
export const readVehicleDocument = (filePath: string, password?: string) =>
  unwrap(api().readVehicleDocument(filePath, password))
export const openDocument = (id: number) => unwrap(api().openDocument(id))
export const pickDocument = () => unwrap(api().pickFile('DOCUMENT'))

// ---------------- loans ----------------

export const useLoans = (personId?: number) =>
  useQuery({ queryKey: ['loans', personId ?? 'all'], queryFn: () => unwrap(api().getLoans(personId)) })
export const useSaveLoan = () => useWrite((input: LoanInput) => api().saveLoan(input))
export const useDeleteLoan = () => useWrite((id: number) => api().deleteLoan(id))
export const useAddLoanPayment = () => useWrite((loanId: number, p: Omit<LoanPayment, 'id'>) => api().addLoanPayment(loanId, p))
export const useDeleteLoanPayment = () => useWrite((loanId: number, paymentId: string) => api().deleteLoanPayment(loanId, paymentId))
export const loanPrepayment = (loanId: number, amount: number) => unwrap(api().loanPrepayment(loanId, amount))

// ---------------- the farm ----------------

export const useFarm = (personId?: number) =>
  useQuery({ queryKey: ['farm', personId ?? 'all'], queryFn: () => unwrap(api().getFarm(personId)) })
export const useSaveFarmSeason = () => useWrite((input: FarmSeasonInput) => api().saveFarmSeason(input))
export const useDeleteFarmSeason = () => useWrite((id: number) => api().deleteFarmSeason(id))
export const useSaveFarmEntry = () => useWrite((input: FarmEntryInput) => api().saveFarmEntry(input))
export const useDeleteFarmEntry = () => useWrite((id: number) => api().deleteFarmEntry(id))
export const useCropVarieties = (crop: CropKey, market?: string | null) =>
  useQuery({ queryKey: ['farm-varieties', crop, market ?? ''], queryFn: () => unwrap(api().getCropVarieties(crop, market)) })
export const useSetFarmMarket = () => useWrite((market: string) => api().setFarmMarket(market))
export const useSetFarmPriceTarget = () => useWrite((crop: CropKey, price: number | null) => api().setFarmPriceTarget(crop, price))
export const useRefreshFarmPrices = () => useWrite(() => api().refreshFarmPrices())
export const useSetFarmHolding = () => useWrite((costs: HoldingCosts) => api().setFarmHolding(costs))
export const useSetFarmTransport = () => useWrite((market: string, perQtl: number | null) => api().setFarmTransport(market, perQtl))
export const useMarketNote = () => useWrite((crop: CropKey, fresh?: boolean) => api().getMarketNote(crop, fresh))

// ---------------- Google accounts ----------------

export const useGoogleSetup = () =>
  useQuery({ queryKey: ['googleSetup'], queryFn: () => unwrap(api().getGoogleSetup()) })
export const useSaveGoogleClient = () =>
  useWrite((input: { clientId: string; clientSecret: string; web?: boolean }) => api().saveGoogleClient(input))
export const useConnectGoogle = () => useWrite((personId: number) => api().connectGoogleAccount(personId))
export const useSetGooglePerson = () =>
  useWrite((email: string, personId: number) => api().setGoogleAccountPerson(email, personId))
export const useDisconnectGoogle = () => useWrite((email: string) => api().disconnectGoogleAccount(email))
export const useCheckMail = () => useWrite((email?: string) => api().checkMail(email))

// ---------------- forecast ----------------

export const useForecast = (personId?: number) =>
  useQuery({ queryKey: ['forecast', personId ?? 'all'], queryFn: () => unwrap(api().getForecast(personId)) })
/** Saving the plan only changes the forecast, so only that is fetched again. */
export function useSavePlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (plan: Plan) => unwrap(api().savePlan(plan)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['forecast'] })
  })
}

// ---------------- sector and fund facts ----------------

export const useSectorInsights = (personId?: number) =>
  useQuery({ queryKey: ['sectorInsights', personId ?? 'all'], queryFn: () => unwrap(api().getSectorInsights(personId)) })
export const useFundComparisons = (personId?: number) =>
  useQuery({ queryKey: ['fundComparisons', personId ?? 'all'], queryFn: () => unwrap(api().getFundComparisons(personId)) })

// ---------------- phone app ----------------

export const usePhoneSync = () =>
  useQuery({ queryKey: ['phoneSync'], queryFn: () => unwrap(api().getPhoneSync()) })
export const useConfigurePhone = () =>
  useWrite((input: { account: string; passphrase?: string }) => api().configurePhoneSync(input))
export const useAllowPhoneDrive = () => useWrite((email: string) => api().allowPhoneDrive(email))
export const useSyncPhone = () => useWrite(() => api().syncPhone())
export const useTurnOffPhone = () => useWrite(() => api().turnOffPhoneSync())

// ---------------- Claude: statements and questions ----------------

export const useAiStatus = () => useQuery({ queryKey: ['aiStatus'], queryFn: () => unwrap(api().getAiStatus()) })
export const useSetAiKey = () => useWrite((apiKey: string) => api().setAiKey(apiKey))
export const useRemoveAiKey = () => useWrite(() => api().removeAiKey())
export const useSetAiFeatures = () => useWrite((f: AiFeatures) => api().setAiFeatures(f))
export const usePdfPasswordCount = () => useQuery({ queryKey: ['pdfPasswords'], queryFn: () => unwrap(api().pdfPasswordCount()) })
export const useForgetPdfPasswords = () => useWrite(() => api().forgetPdfPasswords())
export const useImportStatement = () =>
  useWrite((input: { personId: number; filePath: string; password?: string }) => api().importStatement(input))
export const useSpending = (personId?: number) =>
  useQuery({ queryKey: ['spending', personId ?? 'all'], queryFn: () => unwrap(api().getSpending(personId)) })
export const useSetSpendCategory = () => useWrite((txnId: number, category: SpendCategory) => api().setSpendCategory(txnId, category))
export const useDeleteStatement = () => useWrite((id: number) => api().deleteStatement(id))
export const pickStatement = () => unwrap(api().pickFile('STATEMENT'))
export const askMoney = (id: string, history: ChatTurn[]) => unwrap(api().askMoney(id, history))
export const onChatEvent = (fn: (e: ChatEvent) => void) => api().onChatEvent(fn)

// ---------------- research desk ----------------

export const useResearchHome = () =>
  useQuery({
    queryKey: ['research', 'home'],
    queryFn: () => unwrap(api().getResearchHome()),
    // While the download runs, the progress line keeps moving.
    refetchInterval: (q) => (q.state.data?.status.state === 'RUNNING' ? 10_000 : false)
  })

export const useCompany = (symbol: string | undefined, basis: Basis | null) =>
  useQuery({
    queryKey: ['research', 'company', symbol, basis],
    queryFn: () => unwrap(api().getCompany(symbol!, basis)),
    enabled: !!symbol,
    // A company whose results are being fetched right now: look again shortly.
    refetchInterval: (q) => (q.state.data?.results.state === 'WAITING' ? 4000 : false)
  })

export const useCompanySearch = (query: string) =>
  useQuery({
    queryKey: ['research', 'search', query.trim().toUpperCase()],
    queryFn: () => unwrap(api().searchCompanies(query)),
    enabled: query.trim().length > 0,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData
  })

export const useCompanyChart = (symbol: string, range: '1mo' | '6mo' | '1y' | '5y' | 'max') =>
  useQuery({
    // "history" keys are left alone by the price refresh.
    queryKey: ['history', 'company', symbol, range],
    queryFn: () => unwrap(api().getCompanyChart(symbol, range)),
    staleTime: 30 * 60_000
  })

export function useSetResearchSync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (on: boolean) => unwrap(api().setResearchSync(on)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['research'] })
  })
}

/** The research download pushes its own, more frequent, updates: only research queries refetch. */
export function useResearchSubscription() {
  const qc = useQueryClient()
  useEffect(() => api().onResearchUpdate(() => void qc.invalidateQueries({ queryKey: ['research'] })), [qc])
}

export const useScreenData = () =>
  useQuery({ queryKey: ['research', 'screen'], queryFn: () => unwrap(api().getScreenData()), staleTime: 5 * 60_000 })

export const useMarketMonitor = () =>
  useQuery({ queryKey: ['research', 'monitor'], queryFn: () => unwrap(api().getMarketMonitor()) })

export const useWorldBoard = () =>
  useQuery({
    // A "history" key: the minute-by-minute price refresh leaves it alone.
    queryKey: ['history', 'world'],
    queryFn: () => unwrap(api().getWorldBoard()),
    staleTime: 20 * 60_000,
    retry: 1
  })

export const useSavedScreens = () =>
  useQuery({ queryKey: ['research', 'saved-screens'], queryFn: () => unwrap(api().getSavedScreens()) })

export function useSaveScreens() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (screens: Screen[]) => unwrap(api().saveScreens(screens)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['research', 'saved-screens'] })
  })
}

// ---------------- research desk: World map ----------------

/** "history" keys: the half-minute price refresh leaves the (large) world data alone. */
const WORLD_KEY = ['history', 'world-map'] as const

export const useWorldMap = () =>
  useQuery({ queryKey: WORLD_KEY, queryFn: () => unwrap(api().getWorldMap()), staleTime: 10 * 60_000 })

/** Each World map source that finishes updating refreshes the map. */
export function useWorldSubscription() {
  const qc = useQueryClient()
  useEffect(() => api().onWorldUpdate(() => void qc.invalidateQueries({ queryKey: WORLD_KEY })), [qc])
}

export function useSetWorldSync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (on: boolean) => unwrap(api().setWorldSync(on)),
    onSuccess: (map) => qc.setQueryData(WORLD_KEY, map)
  })
}

export function useRefreshWorld() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: () => unwrap(api().refreshWorld()), onSuccess: () => qc.invalidateQueries({ queryKey: WORLD_KEY }) })
}

/** Ships at sea, every minute and a half while the ships layer is on. */
export const useWorldShips = (enabled: boolean) =>
  useQuery({
    queryKey: ['history', 'world-ships'],
    queryFn: () => unwrap(api().getWorldShips()),
    enabled,
    refetchInterval: enabled ? 90_000 : false,
    staleTime: 60_000,
    retry: false
  })

export const useAisStatus = () => useQuery({ queryKey: ['aisStatus'], queryFn: () => unwrap(api().getAisStatus()) })
export const useSetAisKey = () => useWrite((key: string) => api().setAisKey(key))
export const useRemoveAisKey = () => useWrite(() => api().removeAisKey())
