# Supreme Tracking Event Core

Official GTM Template for **SupremeTracking.io**. This tag acts as the central engine for your tracking strategy, allowing you to send events to your own server-side tracking node while simultaneously managing client-side pixels for maximum data reliability.

## 🚀 Key Features

* **Server-Side Ingestion**: Sends events directly to your self-hosted Supreme Tracking node (`/public/ingest.php`).
* **Hybrid Tracking (Meta Pixel)**: Optional built-in browser-side firing for Meta Pixel (`fbq`) with **Automatic Deduplication** (sharing the same `EventID` between Server and Browser).
* **Google Ads Conversions**: Supports sending conversions directly to Google Ads via `gtag`.
* **Enhanced Conversions Support**: Automatically captures user data provided in the tag and formats it for Google Ads Enhanced Conversions (hashing is handled automatically by Google's web libraries).
* **GA4 Integration**: Fetches `client_id` and `session_id` from GA4 cookies/storage to ensure session continuity across your server-side events.

---

## 🛠️ Configuration Guide

### 1. General Settings
* **Tracking Domain**: Enter the domain where your Supreme Tracking node is installed (e.g., `tracking.yoursite.com`). Do not include `https://` or trailing slashes.
* **Ingest Token**: The security token defined in your Supreme Tracking `.env` file or database (matches `INGEST_TOKEN`).

### 2. GA4 Identity (Optional but Recommended)
* **GA4 Measurement ID**: Enter your GA4 Measurement ID (e.g., `G-XXXXXXXX`).
    * *Why?* The tag uses this to look up the correct `ga_session_id` stored in the browser. This ensures that your server-side events (like purchases) are attributed to the correct session in Google Analytics 4.

### 3. Event Configuration
* **Event Name**: Select a standard event (e.g., `purchase`, `lead`, `add_to_cart`) or choose "Custom" to type your own name.
* **Event ID**: (Optional) Leave blank to let the tag generate a unique UUID automatically.
    * *Note*: If you are firing a separate custom HTML tag for the pixel and want to deduplicate manually, enter a variable here. Otherwise, leave it blank for automatic handling.

### 4. Meta (Facebook) Settings
* **Also send via browser (Meta Pixel)**: Check this box to fire the standard `fbq('track')` event in the browser immediately.
    * The tag automatically synchronizes the `EventID` sent to your server and the one sent to the browser to ensure Meta can deduplicate the events.

### 5. Google Ads Settings
* **Send Conversion to Google Ads?**: Check this to fire a Google Ads conversion.
* **Conversion ID**: Your Google Ads account ID (e.g., `AW-123456789`).
* **Conversion Label**: The specific label for the conversion action (e.g., `AbC_xYz123`).
* **Enhanced Conversions**: The tag automatically uses the data entered in the **"Dados do usuário" (User Data)** section. No extra variable creation for `user_provided_data` is required.

---

## 📝 Data Mapping

### User Data (Enhanced Conversions & CAPI)
In the **"Dados do usuário"** section, map your GTM variables to the corresponding fields:
* **Email**: Map to your email variable (e.g., `{{dlv - email}}`).
* **Phone**: Map to your phone variable.
* **Address Fields**: First Name, Last Name, City, State, ZIP, Country.

> **Note**: This data is used for:
> 1. Enriched data sent to your Supreme Tracking Server (for Meta CAPI).
> 2. Google Ads Enhanced Conversions (automatically formatted and hashed by the tag).

### E-commerce Data
For sales events (`purchase`, `add_to_cart`, `initiate_checkout`), fill in the **Ecommerce Block**:
* **Currency**: e.g., `BRL`, `USD`.
* **Value**: The total value of the conversion.
* **Items**: Add rows for products (Item ID, Name, Price, Quantity).

---

## 🍪 Cookie & Storage Access
This template requires permission to:
1.  **Read Cookies**: To retrieve `_fbp`, `_fbc`, and `stuid` (Supreme Tracking User ID).
2.  **Read Analytics Storage**: To retrieve GA4 `client_id` and `session_id`.
3.  **Inject Scripts**: To run `fbq` (Meta) and `gtag` (Google Ads) when those options are enabled.

## ⚠️ Requirements
* A working installation of **Supreme Tracking** on your server.
* **Google Tag Manager** web container.