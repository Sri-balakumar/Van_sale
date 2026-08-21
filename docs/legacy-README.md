NEX GENN POS Mobile Application

Detailed README & Technical Overview

1. Introduction

NEX GENN POS Mobile Application is a React Native–based Point of Sale (POS) system designed to work seamlessly with an Odoo backend.
The application enables retail stores, restaurants, and showrooms to manage orders, products, and payments using a mobile device.

The app is built with modular architecture, clean separation of concerns, and scalable components, making it suitable for future enhancements.

2. Key Objectives

Provide a fast and user-friendly POS interface

Integrate securely with Odoo POS backend

Support multiple payment methods

Enable category-based product browsing

Ensure stable performance on low-end devices

3. Technology Stack
Frontend

React Native

Expo

React Navigation

Gorhom Bottom Sheet

React Native Snap Carousel

Backend

Odoo (POS module)

JSON-RPC / REST APIs

Supporting Libraries

Custom React Hooks

Toast notifications

Overlay loaders

4. Folder Structure (Detailed)
src/
├── api/
│   ├── services/
│   │   └── generalApi.js          # Category & product APIs
│   └── details/
│       └── detailApi.js           # Barcode & product detail APIs
│
├── assets/
│   ├── images/
│   │   ├── Home/
│   │   │   └── Banner/            # Home screen banners
│   │   └── logo/
│
├── components/
│   ├── Home/
│   │   ├── CarouselPagination.js  # Banner carousel with click handling
│   │   ├── Header.js              # App header
│   │   ├── ImageContainer.js      # Action buttons (Take Orders)
│   │   └── ListHeader.js          # Section headers
│   ├── Categories/
│   │   └── CategoryList.js
│   ├── Loader/
│   └── Toast/
│
├── screens/
│   ├── HomeScreen.js              # Main landing screen
│   ├── POSRegister.js             # POS register screen
│   ├── Products.js                # Product listing screen
│   ├── ProductDetail.js           # Product detail view
│
├── hooks/
│   ├── useDataFetching.js         # API data fetching hook
│   └── useLoader.js               # Global loading state
│
├── utils/
│   └── formatters.js              # Grid & data formatting
│
├── constants/
│   └── theme.js                   # Colors & UI constants

5. Application Flow (End-to-End)
5.1 Login Flow

App opens with Login screen

User enters:

Server URL

Username

Password

App authenticates against Odoo

On success → navigates to Home Screen

5.2 Home Screen Flow

The Home Screen is the central navigation hub.

Components:

Header

Banner Carousel

“Take Orders” button

Category listing (Bottom Sheet)

Special Behavior:

Desktop POS Machine banner is clickable

Click action is controlled from HomeScreen

Touch handling is implemented in CarouselPagination

5.3 Banner Click Architecture (Important Design)

Why this design is used:

UI logic stays inside component

Navigation logic stays in screen

Easy to change behavior later

Flow:
User taps banner
↓
CarouselPagination detects press
↓
Calls onBannerPress()
↓
HomeScreen decides action (navigate / open website)

5.4 Category & Product Flow

Categories fetched from Odoo

Categories named Food and Drinks are filtered out

Duplicate categories are removed

User selects a category

Products are fetched using category ID

User navigates to Product list

5.5 Product Detail & Barcode Scan

Barcode scanning supported

Barcode is sent to Odoo API

Matching product details are returned

If not found → user is notified

5.6 Order & Payment Flow

User adds products

Quantity and discount applied

Order placed

Payment options:

Cash

Card

Customer Account

Invoice generated after payment

6. Back Button Handling (Android)

Single back press → Toast message

Second back press within 2 seconds → Exit app

This avoids accidental app closure.

7. Performance Considerations

Lazy loading of categories

Pagination for product lists

Bottom Sheet used to optimize screen space

Overlay loader prevents multiple API calls

8. Installation & Setup
Prerequisites

Node.js (v16+ recommended)

Expo CLI

Android Studio / Emulator or physical device

Running Odoo backend with POS enabled

Install Dependencies
npm install
# or
yarn install

Run Application
npx expo start

Clear Cache (Recommended)
npx expo start -c

9. Configuration Notes

Server URL must be reachable from device

Odoo POS APIs must be enabled

Correct CORS / authentication settings required

10. Error Handling

API errors are shown via toast messages

Network issues are handled gracefully

Empty product results handled safely

11. Known Limitations

Offline mode not yet supported

Single POS session per device

Limited reporting inside mobile app

12. Future Enhancements

Offline POS support

Role-based access control

Sales analytics dashboard

Multi-branch support

Printer integration

13. Security Notes

Credentials are not stored in plain text

API access controlled by Odoo permissions

Sensitive actions handled server-side

14. License

This application is proprietary software developed for NEX GENN POS.
Unauthorized distribution or modification is not permitted.

15. Support & Maintenance

For support:

Verify Odoo server availability

Check API credentials

Review Metro logs for errors
