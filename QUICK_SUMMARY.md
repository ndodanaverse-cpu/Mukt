# QUICK REFERENCE - CRITICAL ISSUES

## 🔴 MUST FIX IMMEDIATELY (Blocking Issues)

### 1. **Missing Firestore Import in index.html**
- Line: ~87
- Error: `db` is used but never imported/initialized
- Fix: Add: `import { getFirestore } from "...firebase-firestore.js";` and `const db = getFirestore(app);`

### 2. **Missing Auth Guards on 6+ Pages**
Pages without authentication checks:
- customer-home.html ❌
- customer-profile.html ❌
- customer-search.html ❌
- customer-product-detail.html ❌
- vendor-add-product.html ❌
- customer-checkout.html ❌
- customer-orders.html ❌

**Impact:** Unauthenticated users can access pages and cause crashes when accessing user data

### 3. **Undefined Functions in customer-home.html**
These functions are called in HTML but never defined:
- `toggleNav()` - UNDEFINED
- `loadVendors()` - UNDEFINED
- `loadProducts()` - UNDEFINED
- `addToCart()` - UNDEFINED
- `likeProduct()` - UNDEFINED
- `goToProduct()` - UNDEFINED
- `goToVendor()` - UNDEFINED

**Impact:** Page will crash when user interacts with any buttons

### 4. **No Error Handling for Async Operations**
- login.html: `getDoc()` can fail silently, no catch block
- signup.html: `setDoc()` operations have no error validation before redirect
- vendor-dashboard.html: Failed queries don't properly alert user

### 5. **Missing Checkout Implementation**
- No payment method validation
- No order creation logic
- No Firebase collection to store orders
- No payment processing

### 6. **Missing Product Upload Handler**
- vendor-add-product.html shows image upload UI
- No Firebase Storage integration
- No `uploadImage()` or `handleSubmit()` functions
- No product creation logic

### 7. **Missing Logout Functionality**
- No `handleLogout()` function anywhere
- Users cannot sign out from their account
- Need to add logout button to profile pages

---

## 🟠 HIGH PRIORITY ISSUES

### 8. **Weak Input Validation**
- Phone validation accepts ANY 9 characters (should be Zimbabwe format)
- No email uniqueness check (relies on Firebase auth)
- Promo codes hardcoded in client-side JavaScript (security risk)

### 9. **Cart Data Not Secure**
- Pricing stored in localStorage (users can modify)
- No server-side validation
- Should move to Firestore or validate on backend

### 10. **Missing Firestore Collections**
Not defined anywhere:
- `orders` - Referenced but never created
- `products` - UI shows them but collection doesn't exist
- `conversations`/`messages` - Chat UI exists with no persistence
- `listings` - Used in vendor-listings.html

### 11. **Unhandled Promises**
- onAuthStateChanged calls async operations but doesn't properly handle all errors
- Race conditions between Firebase initialization and data access
- Missing error boundaries for async chaining

---

## 🟡 MEDIUM PRIORITY

### 12. **Missing Null Checks**
Multiple files don't check `snap.exists()` before accessing `snap.data()`

### 13. **Timestamp Handling Inconsistencies**
Code assumes Firebase timestamps have `.toDate()` but doesn't validate type

### 14. **Form Validation Issues**
- Confirm password doesn't validate against password field
- No real-time validation feedback
- Terms checkbox marked as checked by default (confusing)

### 15. **Hardcoded Firebase Config**
Same API key used in all files (consider moving to environment variable or dedicated config file)

---

## QUICK FIX CHECKLIST

- [ ] Add Firestore import to index.html
- [ ] Add `onAuthStateChanged` guard to 7 pages
- [ ] Implement missing functions in customer-home.html (4-5 hours)
- [ ] Add try-catch to all async Firebase operations (1 hour)
- [ ] Move promo codes to backend (1 hour)
- [ ] Implement complete checkout flow (2-3 hours)
- [ ] Implement product upload handler (2 hours)
- [ ] Add logout functionality (15 mins)
- [ ] Improve input validation (45 mins)
- [ ] Create Firestore schema document (30 mins)
- [ ] Add error recovery UI (1 hour)
- [ ] Move sensitive data from localStorage (1 hour)

---

## ESTIMATED TIME TO FIX

- **Critical Issues:** 2-3 hours
- **High Priority:** 3-4 hours
- **Medium Priority:** 2-3 hours
- **Low Priority:** 1-2 hours

**Total:** ~10-12 hours of development

---

## FILES WITH ISSUES

✅ = No issues found  
⚠️ = Minor issues  
❌ = Critical issues  
🔴 = Multiple critical issues  

| File | Status | Main Issues |
|------|--------|-------------|
| index.html | ⚠️ | Missing Firestore import |
| login.html | ⚠️ | Missing error handling in password reset |
| signup.html | ⚠️ | Weak validation, missing error checks |
| onboarding.html | ✅ | No issues found |
| customer-home.html | 🔴 | Many undefined functions, no auth guard |
| customer-profile.html | ⚠️ | No auth guard, no logout function |
| customer-search.html | ⚠️ | No auth guard, incomplete filter logic |
| customer-cart.html | ⚠️ | Insecure localStorage, no auth guard |
| customer-checkout.html | 🔴 | Missing entire checkout implementation |
| customer-orders.html | ⚠️ | No auth guard, missing load logic |
| customer-payment-success.html | ✅ | No issues found |
| customer-product-detail.html | 🔴 | No auth guard, missing functions |
| customer-vendor-profile.html | ⚠️ | No auth guard, missing vendor data |
| customer-map.html | ⚠️ | No auth guard |
| shared-chat.html | 🔴 | No auth guard, no Firestore collection, incomplete |
| shared-chat-list.html | ⚠️ | No auth guard |
| shared-notifications.html | ⚠️ | No auth guard |
| vendor-dashboard.html | ⚠️ | Complex queries without proper error recovery |
| vendor-add-product.html | 🔴 | No Firebase Storage, missing upload handler |
| vendor-orders.html | ⚠️ | No auth guard |
| vendor-listings.html | ⚠️ | No auth guard |
| vendor-earnings.html | ⚠️ | No auth guard |
| vendor-profile.html | ⚠️ | No auth guard, no logout |

---

## DETAILED REPORT

See **CODE_REVIEW_REPORT.md** for complete analysis with line numbers and code examples.
