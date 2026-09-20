import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import './index.css';
import { i18next as i18n, rtlLocales, localeFonts } from './i18n-config';
import { ThemeProvider } from './design-system/theme-provider';
import { AuthProvider } from './auth-context';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProtectedRoute, AdminRoute, GuestRoute, PendingRoute } from './routes/guards';
import { AppLayout } from './layouts/AppLayout';
import Home from './pages/marketing/HomeNew';
import Models from './pages/marketing/ModelsNew';
import ModelDetail from './pages/marketing/ModelDetail';
import Pricing from './pages/marketing/PricingNew';
import Docs from './pages/marketing/DocsNew';
import Privacy from './pages/marketing/Privacy';
import Refund from './pages/marketing/Refund';
import Login from './pages/auth/Login';
import Signup from './pages/auth/Signup';
import PendingVerification from './pages/auth/PendingVerification';
import Dashboard from './pages/user/Dashboard';
import Keys from './pages/user/Keys';
import Logs from './pages/user/Logs';
import Plans from './pages/user/Plans';
import Purchases from './pages/user/Purchases';
import Settings from './pages/user/Settings';
import Wallet from './pages/user/Wallet';
import UserModels from './pages/user/UserModels';
import Usage from './pages/user/Usage';
import Admin from './pages/admin/Admin';
import Providers from './pages/admin/Providers';
import AdminModels from './pages/admin/AdminModels';
import RateLimits from './pages/admin/RateLimits';
import CreditOffers from './pages/admin/CreditOffers';
import AdminPlans from './pages/admin/AdminPlans';
import Users from './pages/admin/Users';
import Payments from './pages/admin/Payments';
import Coupons from './pages/admin/Coupons';
import Announcements from './pages/admin/Announcements';
import Gateways from './pages/admin/Gateways';
import AdminSettings from './pages/admin/AdminSettings';
import NotFound from './pages/NotFound';

function Root() {
	// apply persisted locale on boot
	useEffect(() => {
		const lng = localStorage.getItem('nexor-locale') ?? 'en';
		document.documentElement.lang = lng;
		document.documentElement.dir = rtlLocales.has(lng) ? 'rtl' : 'ltr';
		document.body.style.fontFamily = localeFonts[lng as keyof typeof localeFonts] ?? localeFonts.en;
	}, []);
	return null;
}

function App() {
	return (
		<BrowserRouter>
			<Root />
			<AuthProvider>
			<ThemeProvider>
			<Routes>
				{/* auth pages — standalone, no AppLayout (aurora background fills viewport) */}
				<Route
					path="/login"
					element={
						<GuestRoute>
							<Login />
						</GuestRoute>
					}
				/>
				<Route
					path="/signup"
					element={
						<GuestRoute>
							<Signup />
						</GuestRoute>
					}
				/>

				{/* pending — GitHub account younger than the configured min age */}
					<Route
						path="/pending"
						element={
							<ProtectedRoute>
								<PendingVerification />
							</ProtectedRoute>
						}
					/>

					{/* marketing — standalone with new-design chrome */}
					<Route path="/" element={<Home />} />
					<Route path="/models" element={<Models />} />
					<Route path="/models/:slug" element={<ModelDetail />} />
					<Route path="/pricing" element={<Pricing />} />
					<Route path="/docs" element={<Docs />} />
					<Route path="/privacy" element={<Privacy />} />
					<Route path="/refund" element={<Refund />} />
					{/* user dashboard + admin keep the console layout */}
					<Route element={<AppLayout />}>
					{/* user dashboard */}
					<Route
						path="/dashboard"
						element={
							<ProtectedRoute>
								<PendingRoute>
									<Dashboard />
								</PendingRoute>
							</ProtectedRoute>
						}
					/>
					<Route
						path="/dashboard/keys"
						element={
							<ProtectedRoute>
								<PendingRoute>
									<Keys />
								</PendingRoute>
							</ProtectedRoute>
						}
					/>
					<Route
						path="/dashboard/logs"
						element={
							<ProtectedRoute>
								<PendingRoute>
									<Logs />
								</PendingRoute>
							</ProtectedRoute>
						}
					/>
					<Route
						path="/dashboard/plans"
						element={
							<ProtectedRoute>
								<PendingRoute>
									<Plans />
								</PendingRoute>
							</ProtectedRoute>
						}
					/>
					<Route
						path="/dashboard/purchases"
						element={
							<ProtectedRoute>
								<PendingRoute>
									<Purchases />
								</PendingRoute>
							</ProtectedRoute>
						}
					/>
					<Route
						path="/dashboard/settings"
						element={
							<ProtectedRoute>
								<PendingRoute>
									<Settings />
								</PendingRoute>
							</ProtectedRoute>
						}
					/>
					<Route
						path="/dashboard/models"
						element={
							<ProtectedRoute>
								<PendingRoute>
									<UserModels />
								</PendingRoute>
							</ProtectedRoute>
						}
					/>
					<Route
						path="/dashboard/wallet"
						element={
							<ProtectedRoute>
								<PendingRoute>
									<Wallet />
								</PendingRoute>
							</ProtectedRoute>
						}
					/>
					<Route
						path="/dashboard/usage"
						element={
							<ProtectedRoute>
								<PendingRoute>
									<Usage />
								</PendingRoute>
							</ProtectedRoute>
						}
					/>
					{/* admin console */}
					<Route
						path="/admin"
						element={
							<AdminRoute>
								<Admin />
							</AdminRoute>
						}
					/>
					<Route
						path="/admin/providers"
						element={
							<AdminRoute>
								<Providers />
							</AdminRoute>
						}
					/>
					<Route
						path="/admin/models"
						element={
							<AdminRoute>
								<AdminModels />
							</AdminRoute>
						}
					/>
					<Route
						path="/admin/rate-limits"
						element={
							<AdminRoute>
								<RateLimits />
							</AdminRoute>
						}
					/>
					<Route
						path="/admin/credit-offers"
						element={
							<AdminRoute>
								<CreditOffers />
							</AdminRoute>
						}
					/>
					<Route
						path="/admin/plans"
						element={
							<AdminRoute>
								<AdminPlans />
							</AdminRoute>
						}
					/>
					<Route
						path="/admin/users"
						element={
							<AdminRoute>
								<Users />
							</AdminRoute>
						}
					/>
					<Route
						path="/admin/payments"
						element={
							<AdminRoute>
								<Payments />
							</AdminRoute>
						}
					/>
					<Route
						path="/admin/coupons"
						element={
							<AdminRoute>
								<Coupons />
							</AdminRoute>
						}
					/>
					<Route
						path="/admin/announcements"
						element={
							<AdminRoute>
								<Announcements />
							</AdminRoute>
						}
					/>
					<Route
						path="/admin/gateways"
						element={
							<AdminRoute>
								<Gateways />
							</AdminRoute>
						}
					/>
					<Route
						path="/admin/settings"
						element={
							<AdminRoute>
								<AdminSettings />
							</AdminRoute>
						}
					/>
					</Route>
					{/* end console layout */}
					<Route path="*" element={<NotFound />} />
				</Routes>
			</ThemeProvider>
			</AuthProvider>
		</BrowserRouter>
	);
}

void useLocation;
ReactDOM.createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<ErrorBoundary>
			<App />
		</ErrorBoundary>
	</React.StrictMode>,
);
