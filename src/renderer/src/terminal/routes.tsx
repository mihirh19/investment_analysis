import { Route, Routes } from 'react-router-dom'
import { Overview } from '../pages/Overview'
import { Holdings } from '../pages/Holdings'
import { Activity } from '../pages/Activity'
import { ImportPage } from '../pages/Import'
import { People } from '../pages/People'
import { Exposure } from '../pages/Exposure'
import { Xray } from '../pages/Xray'
import { Sectors } from '../pages/Sectors'
import { News } from '../pages/News'
import { Commodities } from '../pages/Commodities'
import { FundScreener } from '../pages/FundScreener'
import { FundPage } from '../pages/FundPage'
import { Alerts } from '../pages/Alerts'
import { Scenarios } from '../pages/Scenarios'
import { Calendar } from '../pages/Calendar'
import { Dividends } from '../pages/Dividends'
import { Retirement } from '../pages/Retirement'
import { Insurance } from '../pages/Insurance'
import { Settings } from '../pages/Settings'
import { Analysis } from '../pages/Analysis'
import { Performance } from '../pages/Performance'
import { Tax } from '../pages/Tax'
import { Funds } from '../pages/Funds'
import { Rebalance } from '../pages/Rebalance'
import { OtherAssets } from '../pages/OtherAssets'
import { Property } from '../pages/Property'
import { Vehicles } from '../pages/Vehicles'
import { Farm } from '../pages/Farm'
import { Loans } from '../pages/Loans'
import { Forecast } from '../pages/Forecast'
import { Spending } from '../pages/Spending'
import { Research } from '../pages/Research'
import { Flows } from '../pages/Flows'

/** Every screen, by route. Each terminal tab has its own router showing one of these. */
export function AppRoutes() {
  return (
    <Routes>
      <Route index element={<Overview />} />
      <Route path="holdings" element={<Holdings />} />
      <Route path="activity" element={<Activity />} />
      <Route path="import" element={<ImportPage />} />
      <Route path="people" element={<People />} />
      <Route path="exposure" element={<Exposure />} />
      <Route path="xray" element={<Xray />} />
      <Route path="calendar" element={<Calendar />} />
      <Route path="dividends" element={<Dividends />} />
      <Route path="retirement" element={<Retirement />} />
      <Route path="insurance" element={<Insurance />} />
      <Route path="settings" element={<Settings />} />
      <Route path="analysis" element={<Analysis />} />
      <Route path="performance" element={<Performance />} />
      <Route path="tax" element={<Tax />} />
      <Route path="funds" element={<Funds />} />
      <Route path="rebalance" element={<Rebalance />} />
      <Route path="other-assets" element={<OtherAssets />} />
      <Route path="property" element={<Property />} />
      <Route path="vehicles" element={<Vehicles />} />
      <Route path="farm" element={<Farm />} />
      <Route path="loans" element={<Loans />} />
      <Route path="forecast" element={<Forecast />} />
      <Route path="spending" element={<Spending />} />
      <Route path="research" element={<Research />} />
      <Route path="research/screener" element={<Research mode="screener" />} />
      <Route path="research/world" element={<Research mode="world" />} />
      <Route path="research/flows" element={<Flows />} />
      <Route path="research/sectors" element={<Sectors />} />
      <Route path="research/news" element={<News />} />
      <Route path="research/commodities" element={<Commodities />} />
      <Route path="research/funds" element={<FundScreener />} />
      <Route path="research/fund/:code" element={<FundPage />} />
      <Route path="alerts" element={<Alerts />} />
      <Route path="scenarios" element={<Scenarios />} />
      <Route path="research/:symbol" element={<Research />} />
      <Route path="*" element={<Overview />} />
    </Routes>
  )
}
