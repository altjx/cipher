package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"
	"github.com/rs/zerolog"
)

// LinkPreviewResponse is the JSON shape returned by GET /api/link-preview.
type LinkPreviewResponse struct {
	URL         string `json:"url"`
	Title       string `json:"title"`
	Description string `json:"description"`
	ImageURL    string `json:"imageUrl"`
	SiteName    string `json:"siteName"`
	FaviconURL  string `json:"faviconUrl"`
	Domain      string `json:"domain"`
}

var (
	ogTagRe    = regexp.MustCompile(`<meta\s+[^>]*(?:property|name)\s*=\s*["']?(og:(?:title|description|image|site_name))["']?\s+content\s*=\s*["']([^"']*?)["'][^>]*/?>`)
	ogTagRev   = regexp.MustCompile(`<meta\s+[^>]*content\s*=\s*["']([^"']*?)["']\s+(?:property|name)\s*=\s*["']?(og:(?:title|description|image|site_name))["']?[^>]*/?>`)
	titleTagRe = regexp.MustCompile(`(?i)<title[^>]*>([^<]+)</title>`)
	descTagRe  = regexp.MustCompile(`(?i)<meta\s+[^>]*name\s*=\s*["']description["']\s+content\s*=\s*["']([^"']*?)["'][^>]*/?>`)
	descTagRev = regexp.MustCompile(`(?i)<meta\s+[^>]*content\s*=\s*["']([^"']*?)["']\s+name\s*=\s*["']description["'][^>]*/?>`)
	faviconRe  = regexp.MustCompile(`(?i)<link\s+[^>]*rel\s*=\s*["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*href\s*=\s*["']([^"']+)["'][^>]*/?>`)
	faviconRev = regexp.MustCompile(`(?i)<link\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*/?>`)
)

// fetchLinkPreview fetches the URL and parses Open Graph / HTML meta tags.
func fetchLinkPreview(rawURL string, logger zerolog.Logger) (*LinkPreviewResponse, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	req.Header.Set("Accept-Encoding", "identity")
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("Sec-Fetch-Dest", "document")
	req.Header.Set("Sec-Fetch-Mode", "navigate")
	req.Header.Set("Sec-Fetch-Site", "none")
	req.Header.Set("Sec-Fetch-User", "?1")
	req.Header.Set("Upgrade-Insecure-Requests", "1")

	// Use a client with a cookie jar so sites like YouTube that set consent
	// cookies and redirect will work correctly within a single fetch.
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	contentType := resp.Header.Get("Content-Type")
	if !strings.Contains(contentType, "text/html") && !strings.Contains(contentType, "application/xhtml") {
		return &LinkPreviewResponse{URL: rawURL, Domain: extractDomain(rawURL)}, nil
	}

	// Read up to 768KB — some sites (YouTube) inline huge JS blobs before <head> meta tags.
	body, err := io.ReadAll(io.LimitReader(resp.Body, 768*1024))
	if err != nil {
		return nil, err
	}
	html := string(body)

	preview := &LinkPreviewResponse{
		URL:    rawURL,
		Domain: extractDomain(rawURL),
	}

	// Parse OG tags (both attribute orderings: property...content and content...property)
	for _, m := range ogTagRe.FindAllStringSubmatch(html, -1) {
		setOGField(preview, m[1], m[2])
	}
	for _, m := range ogTagRev.FindAllStringSubmatch(html, -1) {
		setOGField(preview, m[2], m[1])
	}

	// Fallback to <title> and <meta name="description"> if OG tags are missing
	if preview.Title == "" {
		if m := titleTagRe.FindStringSubmatch(html); m != nil {
			preview.Title = strings.TrimSpace(m[1])
		}
	}
	if preview.Description == "" {
		if m := descTagRe.FindStringSubmatch(html); m != nil {
			preview.Description = strings.TrimSpace(m[1])
		} else if m := descTagRev.FindStringSubmatch(html); m != nil {
			preview.Description = strings.TrimSpace(m[1])
		}
	}

	// Extract favicon from <link rel="icon"> tags
	if m := faviconRe.FindStringSubmatch(html); m != nil {
		preview.FaviconURL = resolveURL(rawURL, strings.TrimSpace(m[1]))
	} else if m := faviconRev.FindStringSubmatch(html); m != nil {
		preview.FaviconURL = resolveURL(rawURL, strings.TrimSpace(m[1]))
	}
	// Fallback: /favicon.ico at the site root
	if preview.FaviconURL == "" {
		if u, err := url.Parse(rawURL); err == nil {
			preview.FaviconURL = u.Scheme + "://" + u.Host + "/favicon.ico"
		}
	}

	return preview, nil
}

func setOGField(p *LinkPreviewResponse, prop, value string) {
	switch prop {
	case "og:title":
		if p.Title == "" {
			p.Title = strings.TrimSpace(value)
		}
	case "og:description":
		if p.Description == "" {
			p.Description = strings.TrimSpace(value)
		}
	case "og:image":
		if p.ImageURL == "" {
			p.ImageURL = strings.TrimSpace(value)
		}
	case "og:site_name":
		if p.SiteName == "" {
			p.SiteName = strings.TrimSpace(value)
		}
	}
}

// garbageTitles are titles returned by bot-challenge pages (Cloudflare, etc.)
// that should not be cached or displayed.
var garbageTitles = []string{
	"just a moment",
	"attention required",
	"access denied",
	"please wait",
	"checking your browser",
	"one more step",
	"security check",
	"before you continue",
	"consent",
}

// isGarbagePreview returns true if the preview looks like a bot-challenge page.
func isGarbagePreview(p *LinkPreviewResponse) bool {
	if p.Title == "" {
		return false
	}
	lower := strings.ToLower(p.Title)
	for _, g := range garbageTitles {
		if lower == g || strings.HasPrefix(lower, g) {
			return true
		}
	}
	return false
}

// needsBrowserFallback returns true if the preview result is empty or looks
// like a bot-challenge page — meaning we should retry with a headless browser.
func needsBrowserFallback(p *LinkPreviewResponse) bool {
	if p == nil {
		return true
	}
	if isGarbagePreview(p) {
		return true
	}
	return p.Title == "" && p.Description == "" && p.ImageURL == ""
}

// browserAvailable tracks whether a usable Chrome/Chromium binary was found.
// Once a launch fails due to a missing binary, we stop trying for the process lifetime.
var (
	browserOnce      sync.Once
	browserAvailable bool
)

// browserAllocOpts returns Chrome flags for the new headless mode with
// anti-detection measures. The "new" headless mode (Chrome 112+) uses the
// full browser pipeline, making it virtually indistinguishable from headed
// Chrome — critical for bypassing PerimeterX, Cloudflare, etc.
func browserAllocOpts() []chromedp.ExecAllocatorOption {
	return []chromedp.ExecAllocatorOption{
		chromedp.NoFirstRun,
		chromedp.NoDefaultBrowserCheck,
		chromedp.Flag("headless", "new"),
		chromedp.Flag("disable-gpu", true),
		chromedp.Flag("no-sandbox", true),
		chromedp.Flag("disable-extensions", true),
		chromedp.Flag("disable-blink-features", "AutomationControlled"),
		chromedp.Flag("disable-dev-shm-usage", true),
		chromedp.Flag("disable-background-networking", true),
		chromedp.Flag("disable-default-apps", true),
		chromedp.Flag("disable-sync", true),
		chromedp.Flag("disable-translate", true),
		chromedp.Flag("metrics-recording-only", true),
		chromedp.Flag("mute-audio", true),
		chromedp.Flag("safebrowsing-disable-auto-update", true),
		chromedp.UserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"),
		chromedp.WindowSize(1920, 1080),
	}
}

// stealthJS is injected before page load to hide automation signals from
// bot-detection systems (PerimeterX, Akamai, DataDome, etc.).
const stealthJS = `
	Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
	window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){} };
	Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
	Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
	const originalQuery = window.navigator.permissions.query;
	window.navigator.permissions.query = (parameters) => (
		parameters.name === 'notifications' ?
			Promise.resolve({ state: Notification.permission }) :
			originalQuery(parameters)
	);
`

// checkBrowser probes for a Chrome/Chromium binary once.
func checkBrowser() bool {
	browserOnce.Do(func() {
		actx, acancel := chromedp.NewExecAllocator(context.Background(), browserAllocOpts()...)
		ctx, cancel := chromedp.NewContext(actx)
		err := chromedp.Run(ctx, chromedp.Navigate("about:blank"))
		cancel()
		acancel()
		browserAvailable = err == nil
	})
	return browserAvailable
}

// fetchWithBrowser uses headless Chrome (new headless mode) to render the page
// and extract OG metadata. This handles sites with JavaScript-based bot
// protection (PerimeterX, Cloudflare JS challenges, etc.) that block plain
// HTTP fetches.
func fetchWithBrowser(rawURL string, logger zerolog.Logger) (*LinkPreviewResponse, error) {
	if !checkBrowser() {
		return nil, fmt.Errorf("no Chrome/Chromium browser available")
	}

	allocCtx, allocCancel := chromedp.NewExecAllocator(context.Background(), browserAllocOpts()...)
	defer allocCancel()

	ctx, cancel := chromedp.NewContext(allocCtx)
	defer cancel()

	// Overall timeout for the browser operation.
	ctx, timeoutCancel := context.WithTimeout(ctx, 15*time.Second)
	defer timeoutCancel()

	// JavaScript snippet that extracts all metadata in a single round-trip.
	const extractJS = `(() => {
		const og = (p) => {
			const el = document.querySelector('meta[property="' + p + '"]') ||
			           document.querySelector('meta[name="' + p + '"]');
			return el ? el.getAttribute('content') || '' : '';
		};
		const meta = (n) => {
			const el = document.querySelector('meta[name="' + n + '"]');
			return el ? el.getAttribute('content') || '' : '';
		};
		const favicon = (() => {
			const el = document.querySelector('link[rel="icon"]') ||
			           document.querySelector('link[rel="shortcut icon"]') ||
			           document.querySelector('link[rel="apple-touch-icon"]');
			return el ? el.getAttribute('href') || '' : '';
		})();
		return {
			title:       og('og:title') || document.title || '',
			description: og('og:description') || meta('description') || '',
			image:       og('og:image') || '',
			siteName:    og('og:site_name') || '',
			favicon:     favicon,
		};
	})()`

	var result map[string]string

	err := chromedp.Run(ctx,
		// Inject stealth overrides before any page scripts execute.
		chromedp.ActionFunc(func(ctx context.Context) error {
			_, err := page.AddScriptToEvaluateOnNewDocument(stealthJS).Do(ctx)
			return err
		}),
		chromedp.Navigate(rawURL),
		chromedp.WaitReady("body"),
		// Give JS-heavy / bot-challenge pages time to settle and redirect.
		chromedp.Sleep(5*time.Second),
		chromedp.Evaluate(extractJS, &result),
	)
	if err != nil {
		logger.Warn().Err(err).Str("url", rawURL).Msg("browser fallback failed")
		return nil, err
	}

	preview := &LinkPreviewResponse{
		URL:         rawURL,
		Title:       strings.TrimSpace(result["title"]),
		Description: strings.TrimSpace(result["description"]),
		ImageURL:    strings.TrimSpace(result["image"]),
		SiteName:    strings.TrimSpace(result["siteName"]),
		Domain:      extractDomain(rawURL),
	}

	// Resolve relative image/favicon URLs against the page URL.
	if preview.ImageURL != "" && !strings.HasPrefix(preview.ImageURL, "http") {
		preview.ImageURL = resolveURL(rawURL, preview.ImageURL)
	}
	fav := strings.TrimSpace(result["favicon"])
	if fav != "" {
		preview.FaviconURL = resolveURL(rawURL, fav)
	} else if u, err := url.Parse(rawURL); err == nil {
		preview.FaviconURL = u.Scheme + "://" + u.Host + "/favicon.ico"
	}

	logger.Info().
		Str("url", rawURL).
		Str("title", preview.Title).
		Msg("browser fallback succeeded")

	return preview, nil
}

// resolveURL resolves a potentially relative URL against a base URL.
func resolveURL(base, ref string) string {
	if strings.HasPrefix(ref, "http://") || strings.HasPrefix(ref, "https://") {
		return ref
	}
	b, err := url.Parse(base)
	if err != nil {
		return ref
	}
	r, err := url.Parse(ref)
	if err != nil {
		return ref
	}
	return b.ResolveReference(r).String()
}

func extractDomain(rawURL string) string {
	// Strip scheme
	u := rawURL
	if i := strings.Index(u, "://"); i >= 0 {
		u = u[i+3:]
	}
	// Strip path
	if i := strings.Index(u, "/"); i >= 0 {
		u = u[:i]
	}
	// Strip port
	if i := strings.Index(u, ":"); i >= 0 {
		u = u[:i]
	}
	// Strip www prefix
	u = strings.TrimPrefix(u, "www.")
	return u
}

// isPrivateIP returns true if the IP is in a private, loopback, or link-local range.
func isPrivateIP(ip net.IP) bool {
	privateRanges := []string{
		"127.0.0.0/8",    // Loopback
		"10.0.0.0/8",     // RFC1918
		"172.16.0.0/12",  // RFC1918
		"192.168.0.0/16", // RFC1918
		"169.254.0.0/16", // Link-local
		"::1/128",        // IPv6 loopback
		"fc00::/7",       // IPv6 unique local
		"fe80::/10",      // IPv6 link-local
	}
	for _, cidr := range privateRanges {
		_, network, _ := net.ParseCIDR(cidr)
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

// validateExternalURL checks that the URL resolves to a public (non-private) IP.
func validateExternalURL(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL")
	}

	host := u.Hostname()

	// Resolve the hostname to check the actual IP
	ips, err := net.LookupIP(host)
	if err != nil {
		return fmt.Errorf("cannot resolve host")
	}

	for _, ip := range ips {
		if isPrivateIP(ip) {
			return fmt.Errorf("URL resolves to a private/internal address")
		}
	}
	return nil
}

// GetLinkPreview handles GET /api/link-preview?url=...
func (h *Handlers) GetLinkPreview(w http.ResponseWriter, r *http.Request) {
	rawURL := r.URL.Query().Get("url")
	if rawURL == "" {
		writeError(w, http.StatusBadRequest, "url parameter is required")
		return
	}

	// Only allow http(s) URLs
	if !strings.HasPrefix(rawURL, "http://") && !strings.HasPrefix(rawURL, "https://") {
		writeError(w, http.StatusBadRequest, "url must start with http:// or https://")
		return
	}

	// Block requests to private/internal IP addresses (SSRF protection)
	if err := validateExternalURL(rawURL); err != nil {
		writeError(w, http.StatusBadRequest, "URL not allowed: "+err.Error())
		return
	}

	// Check cache first (skip entries that look like bot-challenge or empty pages)
	if cached, err := h.db.GetLinkPreview(rawURL); err == nil && cached != nil {
		if !needsBrowserFallback(cached) {
			writeJSON(w, http.StatusOK, cached)
			return
		}
		// Garbage/empty cached entry — re-fetch below
	}

	preview, err := fetchLinkPreview(rawURL, h.client.logger)

	// If the direct fetch failed or returned garbage/empty, try headless browser.
	if err != nil || needsBrowserFallback(preview) {
		h.client.logger.Debug().
			Str("url", rawURL).
			Bool("fetchErr", err != nil).
			Bool("garbage", preview != nil && isGarbagePreview(preview)).
			Msg("direct fetch insufficient, trying browser fallback")

		if bp, bErr := fetchWithBrowser(rawURL, h.client.logger); bErr == nil && !needsBrowserFallback(bp) {
			preview = bp
			err = nil
		}
	}

	if err != nil || preview == nil {
		// Return a minimal preview with just the domain rather than an error
		writeJSON(w, http.StatusOK, LinkPreviewResponse{
			URL:    rawURL,
			Domain: extractDomain(rawURL),
		})
		return
	}

	// Only cache if the preview looks legitimate (not a bot challenge page)
	if !isGarbagePreview(preview) {
		_ = h.db.SaveLinkPreview(preview)
	}

	writeJSON(w, http.StatusOK, preview)
}

// ProxyImage proxies an external image through the backend so the frontend
// avoids CORS / referrer-policy issues with og:image and favicon URLs.
// GET /api/link-preview/image?url=...
func (h *Handlers) ProxyImage(w http.ResponseWriter, r *http.Request) {
	imgURL := r.URL.Query().Get("url")
	if imgURL == "" {
		writeError(w, http.StatusBadRequest, "url parameter is required")
		return
	}
	if !strings.HasPrefix(imgURL, "http://") && !strings.HasPrefix(imgURL, "https://") {
		writeError(w, http.StatusBadRequest, "url must start with http:// or https://")
		return
	}
	if err := validateExternalURL(imgURL); err != nil {
		writeError(w, http.StatusBadRequest, "URL not allowed: "+err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", imgURL, nil)
	if err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	req.Header.Set("Sec-Fetch-Dest", "image")
	req.Header.Set("Sec-Fetch-Mode", "no-cors")
	req.Header.Set("Sec-Fetch-Site", "cross-site")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		http.Error(w, "upstream error", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		http.Error(w, "upstream error", resp.StatusCode)
		return
	}

	// Forward content type and cache for 24 hours
	if ct := resp.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.Header().Set("Cache-Control", "public, max-age=86400")

	// Limit to 5MB to prevent abuse
	io.Copy(w, io.LimitReader(resp.Body, 5*1024*1024))
}
