# Privacy policy: Family Portfolio

Family Portfolio is a personal desktop app for Windows that keeps one family's investment and household records. It has no server and no cloud account. This policy covers what it does with data, including Google user data.

## Where data is kept

Everything the app records stays on the computer it runs on, in a database encrypted with a key that only exists on that computer (and in the backup key shown to the user). Nothing is sent to the developer or to any third party.

## Google user data

If the user connects a Google account (Settings → Google accounts), the app asks Google for read-only access to Gmail (`https://www.googleapis.com/auth/gmail.readonly`) and the account's email address.

- **What is read:** the app searches the mailbox for financial statements the user receives, such as the monthly Consolidated Account Statement (CAS), and downloads their PDF attachments to import them into the user's own records. It does not read, store or index other mail.
- **What is stored:** the imported figures (holdings, transactions) and, encrypted on the user's computer, the Google refresh token and the IDs of messages already handled. Attachments are deleted from the computer after import.
- **What is never done:** the app never sends, deletes, labels or changes mail, and never shares, sells or transfers Google user data to anyone. It is not used for advertising, and no person other than the user can see it.
- **Revoking access:** disconnecting the account in Settings revokes the app's access with Google. Access can also be removed at any time from the Google account's security settings (Third-party apps with account access).

The app's use of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

## Other connections

To show live prices and reference data, the app downloads public information (stock prices, fund NAVs, exchange rates, home price indices, mandi crop prices) from public sources. These requests do not include the user's holdings or personal details.

- **Research desk:** downloads public information from NSE, slowly and one file at a time:
  - end-of-day price files and the results filings companies publish;
  - the results and corporate-actions calendars;
  - shareholding patterns;
  - company announcements;
  - each company's sector classification.

  The download can be paused in Research. Price history comes from Yahoo Finance. Fetching a company's shareholding patterns tells NSE which company was looked up, as visiting its page would.
- **Money flows:** only after the screen is first opened, the app downloads the following, slowly. Updates can be paused on the screen.
  - From NSE: FII/DII figures, F&O participant positions, bulk and block deals, and takeover disclosures.
  - From NSDL: its foreign portfolio investment reports.
  - From AMFI: its monthly mutual fund reports.
- **Fund screener:** only after the screen is first opened, the app downloads the following, slowly and with a pause button:
  - AMFI's list of funds;
  - each fund's NAV history from mfapi.in;
  - index levels from Yahoo Finance;
  - for funds you choose to follow, the fund house's monthly portfolio file.
- **Charts and watchlists:** delayed prices and price history come from Yahoo Finance.
- **World map:** only after the map is first opened, the app downloads public figures from:
  - IMF PortWatch (ArcGIS);
  - UN Comtrade;
  - the World Bank, the BIS and the OECD;
  - Yahoo Finance;
  - USGS and GDACS;
  - the Shanghai Shipping Exchange;
  - Fintraffic's Digitraffic (Baltic ship positions).

  Updates can be paused on the map.
- **Farm weather:** if the user picks the farm's village, its name is sent to Open-Meteo's place search once, and then its map position (latitude and longitude) every few hours for the forecast. Nothing else is sent.
- **Crop exports:** when asked on the Farm page, India's public export figures for that crop come from UN Comtrade.
- **Live ships worldwide:** if the user enters their own aisstream.io key, the key is stored encrypted on the computer and sent only to aisstream.io, to receive ship positions for a map area.

None of these requests carry the user's holdings or personal details.

**Claude (optional, off unless the user adds their own Anthropic API key):**
- "Ask your money" and the phone's chat send the question and the figures needed to answer it to Anthropic's API, and may include Gmail search results when the user allows the chat to use Gmail.
- Statement reading sends the statement's text; reading a mandi bill sends the photo of the bill.
- The farm market note sends only public crop prices.
- The announcements digest sends the recent public announcements of held and watched companies, which shows Anthropic which companies the family follows, but no amounts or holdings.
- Each feature has its own switch in Settings → Claude.

## Contact

Questions: open an issue at https://github.com/mihirh19/investment_analysis/issues.
