"use client";

import React, { Component, ReactNode, Suspense, useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { resolveTemplateRenderer, preloadTemplateRoutes } from '@/lib/template-components';
import { CustomizationProvider } from '@/context/CustomizationContext';
import { CustomerAuthProvider } from '@/context/CustomerAuthContext';
import { BuilderOverlay } from '@/components/builder/BuilderOverlay';
import { resolveLiveRoute } from '@/lib/route-resolver';
import { RouteLoadingSkeleton } from '@/components/RouteLoadingSkeleton';

interface TemplateRendererProps {
  siteData: any;
  products: any[];
  basePath?: string;
  activePath?: string;
  isBuilderContext?: boolean;
  onNavigate?: (path: string) => void;
  siteId?: string;
}

class TemplateErrorBoundary extends Component<{ children: ReactNode; templateSlug: string }, { hasError: boolean; error: Error | null }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error(`Template Error in [${this.props.templateSlug}]:`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full min-h-[350px] flex flex-col items-center justify-center bg-[#0d0d0d] text-white p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 mb-4 text-xl font-bold">
            !
          </div>
          <h2 className="text-lg font-semibold mb-2">Unable to render template ({this.props.templateSlug})</h2>
          <p className="text-white/50 text-xs max-w-md mb-4 font-mono">
            {this.state.error?.message || 'An unexpected error occurred while rendering this page.'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-semibold transition-colors"
          >
            Retry Render
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function TemplateRenderer({ 
  siteData, 
  products, 
  basePath = "", 
  activePath = "/", 
  isBuilderContext = false, 
  onNavigate, 
  siteId 
}: TemplateRendererProps) {
  // 1. Resolve template configuration
  const { templateSlug, templateRoutes, TemplateLayout } = useMemo(
    () => resolveTemplateRenderer(siteData),
    [siteData?.global?.templateSlug, siteData?.templateSlug]
  );

  // 2. Preload all routes for this template in the background on mount
  useEffect(() => {
    preloadTemplateRoutes(templateSlug);
  }, [templateSlug]);

  // 3. Client-side instant route state
  const [currentPath, setCurrentPath] = useState<string>(activePath);

  // Synchronize when parent activePath changes (e.g., initial server load or Builder prop change)
  useEffect(() => {
    setCurrentPath(activePath);
  }, [activePath]);

  // 4. Instant navigation dispatcher
  const handleClientNavigate = useCallback((targetPath: string) => {
    if (!targetPath) return;

    // Clean and normalize target relative path
    let relative = targetPath;
    if (basePath && relative.startsWith(basePath)) {
      relative = relative.slice(basePath.length) || '/';
    }
    if (!relative.startsWith('/')) {
      relative = '/' + relative;
    }

    // Update active route state instantly in 0ms (no network delay, no server roundtrip)
    setCurrentPath(relative);

    // Update browser URL & history without full page reload
    if (typeof window !== 'undefined' && !isBuilderContext) {
      const fullUrl = `${basePath}${relative === '/' ? '' : relative}` || '/';
      if (window.location.pathname !== fullUrl) {
        window.history.pushState({ path: relative }, '', fullUrl);
      }
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    }

    if (onNavigate) {
      onNavigate(relative);
    }
  }, [basePath, isBuilderContext, onNavigate]);

  // 5. Browser back/forward (popstate) listener for instant client-side history navigation
  useEffect(() => {
    if (typeof window === 'undefined' || isBuilderContext) return;

    const handlePopState = () => {
      const pathname = window.location.pathname;
      let relative = pathname;
      if (basePath && relative.startsWith(basePath)) {
        relative = relative.slice(basePath.length) || '/';
      }
      if (!relative.startsWith('/')) {
        relative = '/' + relative;
      }
      setCurrentPath(relative);
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [basePath, isBuilderContext]);

  // 6. Global link click interceptor for ultra-fast instant snapping
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleLinkClick = (e: MouseEvent) => {
      // Find nearest anchor tag
      const anchor = (e.target as HTMLElement)?.closest('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href) return;

      // Ignore external links, hash anchors, mailto, tel, downloads, new tabs
      if (
        href.startsWith('http://') || 
        href.startsWith('https://') || 
        href.startsWith('mailto:') || 
        href.startsWith('tel:') || 
        href.startsWith('#') ||
        anchor.getAttribute('target') === '_blank' ||
        anchor.hasAttribute('download') ||
        e.ctrlKey || e.metaKey || e.shiftKey || e.altKey ||
        e.button !== 0 // Only primary click
      ) {
        return;
      }

      // Check if href is internal to this site
      const isInternal = href.startsWith('/') || (basePath && href.startsWith(basePath));
      if (isInternal) {
        e.preventDefault();
        e.stopPropagation();
        handleClientNavigate(href);
      }
    };

    container.addEventListener('click', handleLinkClick, true);
    return () => container.removeEventListener('click', handleLinkClick, true);
  }, [handleClientNavigate, basePath]);

  // 7. Resolve canonical route
  const resolved = useMemo(() => resolveLiveRoute(currentPath), [currentPath]);
  const canonicalPath = resolved.canonicalPath;

  // 8. Lookup component in template routes
  let TemplateComponent = templateRoutes ? templateRoutes[canonicalPath] : null;

  // 9. Dynamic product detail route fallback
  if (!TemplateComponent && resolved.isDynamicProduct && templateRoutes) {
    TemplateComponent = templateRoutes['/products/[id]'] || templateRoutes['/products'];
  }

  // 10. Fallbacks for optional routes if template doesn't define them
  if (!TemplateComponent && templateRoutes) {
    if (canonicalPath === '/cart' || canonicalPath === '/checkout') {
      TemplateComponent = templateRoutes['/cart'] || templateRoutes['/checkout'] || templateRoutes['/products'] || templateRoutes['/'];
    } else if (canonicalPath === '/orders') {
      TemplateComponent = templateRoutes['/orders'] || templateRoutes['/profile'] || templateRoutes['/'];
    } else if (canonicalPath === '/wishlist') {
      TemplateComponent = templateRoutes['/wishlist'] || templateRoutes['/products'] || templateRoutes['/'];
    } else if (canonicalPath === '/profile' || canonicalPath.startsWith('/auth/')) {
      TemplateComponent = templateRoutes['/profile'] || templateRoutes['/auth/login'] || templateRoutes['/'];
    } else {
      TemplateComponent = templateRoutes['/'] || Object.values(templateRoutes)[0];
    }
  }

  const componentParams = useMemo(() => ({
    ...resolved.params,
    id: resolved.productId || resolved.params?.id || 'preview',
  }), [resolved.params, resolved.productId]);

  if (!TemplateComponent) {
    return (
      <div className="w-full h-full min-h-[300px] flex flex-col items-center justify-center bg-[#0d0d0d] text-white p-6 text-center">
        <h1 className="text-xl font-bold mb-2">404 - Page Not Found</h1>
        <p className="text-white/60 text-sm">The route <strong>{currentPath}</strong> does not exist in template <strong>{templateSlug}</strong>.</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full min-h-screen">
      <TemplateErrorBoundary templateSlug={templateSlug}>
        <CustomizationProvider 
          siteData={siteData} 
          products={products} 
          basePath={basePath}
          isBuilderContext={isBuilderContext}
          activePath={resolved.publicPath}
          onNavigate={handleClientNavigate}
        >
          <CustomerAuthProvider siteId={siteId || ''}>
            <TemplateLayout>
              {isBuilderContext && <BuilderOverlay />}
              <Suspense fallback={<RouteLoadingSkeleton canonicalPath={canonicalPath} />}>
                <div key={canonicalPath} className="w-full animate-section-in">
                  <TemplateComponent params={componentParams} />
                </div>
              </Suspense>
            </TemplateLayout>
          </CustomerAuthProvider>
        </CustomizationProvider>
      </TemplateErrorBoundary>
    </div>
  );
}
