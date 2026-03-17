package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/rs/zerolog"
)

// LinkPreviewResponse is the JSON shape returned by GET /api/link-preview.
type LinkPreviewResponse struct {
	URL         string `json:"url"`
	Title       string `json:"title"`
	Description string `json:"description"`
	ImageURL    string `json:"imageUrl"`
	SiteName    string `json:"siteName"`
	Domain      string `json:"domain"`
}

var (
	ogTagRe   = regexp.MustCompile(`<meta\s+[^>]*(?:property|name)\s*=\s*["']?(og:(?:title|description|image|site_name))["']?\s+content\s*=\s*["']([^"']*?)["'][^>]*/?>`)
	ogTagRev  = regexp.MustCompile(`<meta\s+[^>]*content\s*=\s*["']([^"']*?)["']\s+(?:property|name)\s*=\s*["']?(og:(?:title|description|image|site_name))["']?[^>]*/?>`)
	titleTagRe = regexp.MustCompile(`(?i)<title[^>]*>([^<]+)</title>`)
	descTagRe  = regexp.MustCompile(`(?i)<meta\s+[^>]*name\s*=\s*["']description["']\s+content\s*=\s*["']([^"']*?)["'][^>]*/?>`)
	descTagRev = regexp.MustCompile(`(?i)<meta\s+[^>]*content\s*=\s*["']([^"']*?)["']\s+name\s*=\s*["']description["'][^>]*/?>`)
)

// fetchLinkPreview fetches the URL and parses Open Graph / HTML meta tags.
func fetchLinkPreview(rawURL string, logger zerolog.Logger) (*LinkPreviewResponse, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; LinkPreview/1.0)")
	req.Header.Set("Accept", "text/html")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	contentType := resp.Header.Get("Content-Type")
	if !strings.Contains(contentType, "text/html") && !strings.Contains(contentType, "application/xhtml") {
		return &LinkPreviewResponse{URL: rawURL, Domain: extractDomain(rawURL)}, nil
	}

	// Read up to 64KB — OG tags are in <head> which is near the top.
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
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

	// Check cache first
	if cached, err := h.db.GetLinkPreview(rawURL); err == nil && cached != nil {
		writeJSON(w, http.StatusOK, cached)
		return
	}

	preview, err := fetchLinkPreview(rawURL, h.client.logger)
	if err != nil {
		// Return a minimal preview with just the domain rather than an error
		writeJSON(w, http.StatusOK, LinkPreviewResponse{
			URL:    rawURL,
			Domain: extractDomain(rawURL),
		})
		return
	}

	// Cache it (ignore errors — caching is best-effort)
	_ = h.db.SaveLinkPreview(preview)

	writeJSON(w, http.StatusOK, preview)
}
