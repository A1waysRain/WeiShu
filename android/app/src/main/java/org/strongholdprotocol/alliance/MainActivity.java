package org.strongholdprotocol.alliance;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.security.cert.CertificateFactory;
import java.security.cert.CertificateExpiredException;
import java.security.cert.CertificateNotYetValidException;
import java.security.cert.X509Certificate;
import java.util.Enumeration;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

public final class MainActivity extends Activity {
    private static native int startNode(String scriptPath);

    private final Handler ui = new Handler(Looper.getMainLooper());
    private WebView webView;
    private TextView status;
    private File gameDir;
    private File portFile;
    private long nodeStartedAt;
    private volatile int serverPort;
    private volatile String cachedSafeInsets = "0,0,0,0";
    private String activeOrigin;
    private boolean returningLocal;
    private boolean starting;
    private boolean failed;
    private boolean connectionErrorShown;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        installCrashReport();
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        try {
            System.loadLibrary("node");
            System.loadLibrary("stronghold");
            enableFullscreen();
            startGame();
        } catch (RuntimeException | LinkageError error) {
            showError("应用启动失败：" + error);
        }
    }

    private void installCrashReport() {
        android.content.SharedPreferences reports = getSharedPreferences("startup-diagnostics", MODE_PRIVATE);
        String previous = reports.getString("last-crash", "");
        Thread.UncaughtExceptionHandler original = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            try {
                reports.edit().putString("last-crash", android.util.Log.getStackTraceString(error)).commit();
            } catch (RuntimeException ignored) { /* Preserve Android's normal crash handling. */ }
            if (original != null) original.uncaughtException(thread, error);
        });
        if (!previous.isEmpty()) {
            reports.edit().remove("last-crash").apply();
            ui.post(() -> {
                if (isFinishing()) return;
                new AlertDialog.Builder(this)
                        .setTitle("上次运行异常")
                        .setMessage(previous)
                        .setPositiveButton("复制报错", (dialog, which) -> {
                            android.content.ClipboardManager clipboard =
                                    (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                            if (clipboard != null) clipboard.setPrimaryClip(
                                    android.content.ClipData.newPlainText("应用异常", previous));
                        })
                        .setNegativeButton("关闭", null)
                        .show();
            });
        }
    }

    private void enableFullscreen() {
        Window window = getWindow();
        // PhoneWindow.getInsetsController() can dereference an uninitialized
        // DecorView during onCreate. getDecorView() creates it before any access.
        View decor = window.getDecorView();
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams params = window.getAttributes();
            params.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(params);
        }
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false);
            WindowInsetsController controller = decor.getWindowInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            decor.setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enableFullscreen();
    }

    private void startGame() {
        if (starting) return;
        starting = true;
        LinearLayout loading = new LinearLayout(this);
        loading.setOrientation(LinearLayout.VERTICAL);
        loading.setGravity(Gravity.CENTER);
        loading.setBackgroundColor(0xff0c0f0e);
        loading.setPadding(32, 24, 32, 24);
        ProgressBar progress = new ProgressBar(this);
        loading.addView(progress);
        status = new TextView(this);
        status.setTextColor(0xffd9e6e0);
        status.setTextSize(17);
        status.setGravity(Gravity.CENTER);
        status.setPadding(0, 20, 0, 0);
        status.setText("正在准备游戏资源…首次启动可能需要几分钟");
        loading.addView(status);
        setContentView(loading);

        new Thread(() -> {
            try {
                gameDir = extractGame();
                portFile = new File(gameDir, "mobile-port.txt");
                if (portFile.exists() && !portFile.delete()) throw new IOException("无法清理旧服务端口");
                ui.post(() -> status.setText("正在启动游戏服务…"));
                nodeStartedAt = System.currentTimeMillis();
                new Thread(() -> {
                    try {
                        int exitCode = startNode(new File(gameDir, "mobile-entry.mjs").getAbsolutePath());
                        if (!isFinishing()) ui.post(() -> showError("游戏服务已退出（代码 " + exitCode + "）"));
                    } catch (RuntimeException | LinkageError error) {
                        ui.post(() -> showError("游戏服务启动失败：" + error));
                    }
                }, "stronghold-node").start();
                ui.post(this::waitForServer);
            } catch (Exception error) {
                ui.post(() -> showError("无法准备游戏资源：" + error.getMessage()));
            }
        }, "stronghold-extract").start();
    }

    private File extractGame() throws IOException {
        File destination = new File(getFilesDir(), "game-v" + BuildConfig.VERSION_CODE);
        File marker = new File(destination, ".ready");
        String installedAt;
        try {
            installedAt = Long.toString(getPackageManager().getPackageInfo(getPackageName(), 0).lastUpdateTime);
        } catch (PackageManager.NameNotFoundException error) {
            throw new IOException("无法读取应用版本", error);
        }
        if (marker.isFile()) {
            byte[] stamp = new byte[32];
            try (FileInputStream input = new FileInputStream(marker)) {
                int count = input.read(stamp);
                if (count > 0 && installedAt.equals(new String(stamp, 0, count, StandardCharsets.UTF_8))) {
                    return destination;
                }
            }
        }
        File staging = new File(getFilesDir(), destination.getName() + ".extracting");
        deleteTree(staging);
        if (!staging.mkdirs()) throw new IOException("无法创建资源目录");
        String prefix = staging.getCanonicalPath() + File.separator;
        try (InputStream input = getAssets().open("game.zip"); ZipInputStream zip = new ZipInputStream(input)) {
            ZipEntry entry;
            byte[] buffer = new byte[64 * 1024];
            while ((entry = zip.getNextEntry()) != null) {
                File target = new File(staging, entry.getName());
                if (!target.getCanonicalPath().startsWith(prefix)) throw new IOException("无效资源路径");
                if (entry.isDirectory()) {
                    if (!target.isDirectory() && !target.mkdirs()) throw new IOException("无法创建资源目录");
                } else {
                    File parent = target.getParentFile();
                    if (!parent.isDirectory() && !parent.mkdirs()) throw new IOException("无法创建资源目录");
                    try (FileOutputStream output = new FileOutputStream(target)) {
                        int count;
                        while ((count = zip.read(buffer)) != -1) output.write(buffer, 0, count);
                    }
                }
                zip.closeEntry();
            }
        } catch (IOException error) {
            deleteTree(staging);
            throw error;
        }
        if (!new File(staging, "server/index.js").isFile()
                || !new File(staging, "public/index.html").isFile()
                || !new File(staging, "node_modules/ws/package.json").isFile()) {
            deleteTree(staging);
            throw new IOException("APK 缺少游戏文件");
        }
        deleteTree(destination);
        if (!staging.renameTo(destination)) throw new IOException("无法安装游戏资源");
        try (FileOutputStream output = new FileOutputStream(marker)) {
            output.write(installedAt.getBytes(StandardCharsets.UTF_8));
        }
        return destination;
    }

    private static void deleteTree(File file) throws IOException {
        if (!file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        if (!file.delete()) throw new IOException("无法清理旧资源：" + file.getName());
    }

    private void waitForServer() {
        if (isFinishing()) return;
        if (portFile.isFile()) {
            try {
                byte[] bytes = new byte[256];
                int length;
                try (FileInputStream input = new FileInputStream(portFile)) { length = input.read(bytes); }
                String value = length > 0 ? new String(bytes, 0, length, StandardCharsets.UTF_8).trim() : "";
                if (value.startsWith("ERROR:")) { showError(value.substring(6)); return; }
                int port = Integer.parseInt(value);
                if (port > 0 && port <= 65535) { openGame(port); return; }
            } catch (Exception ignored) { /* the Node thread may still be writing */ }
        }
        if (System.currentTimeMillis() - nodeStartedAt > 30000) {
            showError("游戏服务启动超时。请关闭应用后重试。");
            return;
        }
        ui.postDelayed(this::waitForServer, 200);
    }

    private void openGame(int port) {
        serverPort = port;
        activeOrigin = localOrigin();
        WebView view = new WebView(this);
        webView = view;
        view.setOnApplyWindowInsetsListener((v, insets) -> {
            String next = safeInsets(insets);
            if (!next.equals(cachedSafeInsets)) {
                cachedSafeInsets = next;
                // Do not run WebView script during Android's layout/insets dispatch.
                view.post(() -> {
                    if (!isFinishing() && webView == view) applySafeInsets(view);
                });
            }
            return insets;
        });
        view.setBackgroundColor(0xff0c0f0e);
        view.getSettings().setJavaScriptEnabled(true);
        view.getSettings().setDomStorageEnabled(true);
        view.getSettings().setMediaPlaybackRequiresUserGesture(false);
        view.addJavascriptInterface(new GameBridge(), "StrongholdAndroid");
        view.setWebChromeClient(new WebChromeClient());
        view.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView page, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (request.isForMainFrame() && !checkSakuraCertificate(url)) return true;
                String origin = url.getScheme() + "://" + url.getEncodedAuthority();
                if (activeOrigin.equals(origin)) return false;
                Uri active = Uri.parse(activeOrigin);
                if (request.isForMainFrame() && "http".equals(active.getScheme())
                        && "https".equals(url.getScheme())
                        && active.getHost() != null && active.getHost().equalsIgnoreCase(url.getHost())
                        && (active.getPort() == url.getPort()
                            || ((active.getPort() == -1 || active.getPort() == 80)
                                && (url.getPort() == -1 || url.getPort() == 443)))) {
                    activeOrigin = origin;
                    return false;
                }
                if (request.isForMainFrame()) showConnectionError(
                        "服务器跳转到另一地址，已停止加载。请使用穿透工具提供的最终游戏链接。\n" + url);
                return true;
            }

            @Override public void onPageFinished(WebView page, String url) {
                applySafeInsets(page);
                if (returningLocal) {
                    page.clearHistory();
                    returningLocal = false;
                }
            }

            @Override public void onReceivedError(WebView page, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showConnectionError(
                        "无法加载游戏地址：\n" + request.getUrl() + "\n"
                        + error.getDescription() + "（代码 " + error.getErrorCode() + "）");
            }

            @Override public void onReceivedSslError(WebView page, android.webkit.SslErrorHandler handler,
                    android.net.http.SslError error) {
                handler.cancel();
                String reason;
                switch (error.getPrimaryError()) {
                    case android.net.http.SslError.SSL_IDMISMATCH: reason = "证书与访问域名不匹配"; break;
                    case android.net.http.SslError.SSL_EXPIRED: reason = "证书已过期"; break;
                    case android.net.http.SslError.SSL_NOTYETVALID: reason = "证书尚未生效，请检查设备时间"; break;
                    case android.net.http.SslError.SSL_UNTRUSTED: reason = "证书不受系统信任"; break;
                    default: reason = "HTTPS 证书校验失败";
                }
                showConnectionError(reason + "。请检查内网穿透的 HTTPS 配置和正确访问域名。\n" + error.getUrl());
            }
        });
        setContentView(view);
        view.loadUrl(activeOrigin + "/");
    }

    private String localOrigin() { return "http://127.0.0.1:" + serverPort; }

    private void showConnectionError(String message) {
        if (isFinishing() || connectionErrorShown) return;
        connectionErrorShown = true;
        new AlertDialog.Builder(this).setTitle("联机连接失败").setMessage(message)
                .setPositiveButton("修改链接", (dialog, which) -> showConnectDialog())
                .setNegativeButton("返回本机", (dialog, which) -> {
                    connectionErrorShown = false;
                    activeOrigin = localOrigin();
                    returningLocal = true;
                    webView.loadUrl(activeOrigin + "/");
                }).show();
    }

    private void applySafeInsets(WebView page) {
        String[] values = cachedSafeInsets.split(",", -1);
        if (values.length != 4) return;
        String[] sides = {"t", "r", "b", "l"};
        StringBuilder script = new StringBuilder();
        for (int i = 0; i < sides.length; i++) {
            script.append("document.documentElement.style.setProperty('--android-sa-")
                    .append(sides[i]).append("','").append(values[i]).append("px');");
        }
        page.evaluateJavascript("if(document.documentElement){" + script + "}", null);
    }

    private String safeInsets(WindowInsets insets) {
        int top = 0, right = 0, bottom = 0, left = 0;
        if (insets != null) {
            // Hidden system bars occupy no space. Reserve visible bars and the
            // physical cutout only; exclude the keyboard from HUD safe areas.
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets visible = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                top = visible.top;
                right = visible.right;
                bottom = visible.bottom;
                left = visible.left;
            } else {
                top = insets.getSystemWindowInsetTop();
                right = insets.getSystemWindowInsetRight();
                bottom = insets.getSystemWindowInsetBottom();
                left = insets.getSystemWindowInsetLeft();
            }
            if (Build.VERSION.SDK_INT >= 28 && insets.getDisplayCutout() != null) {
                top = Math.max(top, insets.getDisplayCutout().getSafeInsetTop());
                right = Math.max(right, insets.getDisplayCutout().getSafeInsetRight());
                bottom = Math.max(bottom, insets.getDisplayCutout().getSafeInsetBottom());
                left = Math.max(left, insets.getDisplayCutout().getSafeInsetLeft());
            }
        }
        float density = getResources().getDisplayMetrics().density;
        return Math.round(top / density) + "," + Math.round(right / density) + ","
                + Math.round(bottom / density) + "," + Math.round(left / density);
    }

    private String networkOrigin(boolean overlay) {
        if (serverPort == 0) return "";
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces != null && interfaces.hasMoreElements()) {
                NetworkInterface network = interfaces.nextElement();
                String name = network.getName();
                if (!network.isUp() || network.isLoopback()) continue;
                boolean candidate = overlay
                        ? name.startsWith("tun") || name.startsWith("tap") || name.startsWith("zt") || name.startsWith("tailscale")
                        : name.startsWith("wlan") || name.startsWith("swlan") || name.startsWith("ap") || name.startsWith("eth");
                if (!candidate) continue;
                Enumeration<InetAddress> addresses = network.getInetAddresses();
                while (addresses.hasMoreElements()) {
                    InetAddress address = addresses.nextElement();
                    if (address instanceof Inet4Address && (overlay
                            ? isOverlayIpv4(address.getHostAddress()) || address.isSiteLocalAddress()
                            : address.isSiteLocalAddress())) {
                        return "http://" + address.getHostAddress() + ":" + serverPort;
                    }
                }
            }
        } catch (SocketException ignored) { /* Wi-Fi may be disconnected */ }
        return "";
    }

    private String lanOrigin() {
        String overlay = networkOrigin(true);
        return overlay.isEmpty() ? networkOrigin(false) : overlay;
    }

    private static int[] ipv4Octets(String host) {
        if (host == null) return null;
        String[] parts = host.split("\\.", -1);
        if (parts.length != 4) return null;
        int[] octets = new int[4];
        try {
            for (int i = 0; i < 4; i++) {
                if (parts[i].isEmpty() || parts[i].length() > 3) return null;
                octets[i] = Integer.parseInt(parts[i]);
                if (octets[i] < 0 || octets[i] > 255) return null;
            }
        } catch (NumberFormatException error) { return null; }
        return octets;
    }

    private static boolean isOverlayIpv4(String host) {
        int[] octets = ipv4Octets(host);
        return octets != null && octets[0] == 100 && octets[1] >= 64 && octets[1] <= 127;
    }

    private static boolean isPrivateIpv4(String host) {
        int[] octets = ipv4Octets(host);
        return octets != null && (octets[0] == 10
                || (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31)
                || (octets[0] == 192 && octets[1] == 168));
    }

    private static String normalizeServerUrl(String input) {
        try {
            String value = input.trim();
            if (!value.startsWith("http://") && !value.startsWith("https://")) value = "http://" + value;
            Uri uri = Uri.parse(value);
            String host = uri.getHost();
            int port = uri.getPort();
            // FRP TCP tunnels commonly expose HTTP on a public hostname and port.
            // They must be accepted just like LAN addresses and HTTPS tunnels.
            boolean supportedScheme = "http".equals(uri.getScheme()) || "https".equals(uri.getScheme());
            boolean validHost = host != null && !host.isEmpty() && host.matches("[A-Za-z0-9.-]+");
            boolean validPort = port == -1 || (port >= 1 && port <= 65535);
            if (!supportedScheme || !validHost || !validPort || uri.getUserInfo() != null) return null;
            String room = uri.getQueryParameter("room");
            if (room != null && !room.matches("[A-Za-z0-9]{4,6}")) return null;
            return uri.getScheme() + "://" + host + (port < 0 ? "" : ":" + port) + "/"
                    + (room == null ? "" : "?room=" + room.toUpperCase());
        } catch (RuntimeException error) { return null; }
    }

    private boolean checkSakuraCertificate(Uri url) {
        if (!"https".equalsIgnoreCase(url.getScheme())
                || !"dx.frp-bus.com".equalsIgnoreCase(url.getHost())) return true;
        // A custom trust anchor may not have its validity checked by the TLS
        // verifier. Check the bundled certificate before entering this host.
        try (InputStream input = getResources().openRawResource(R.raw.sakura_dx_certificate)) {
            X509Certificate certificate = (X509Certificate)
                    CertificateFactory.getInstance("X.509").generateCertificate(input);
            certificate.checkValidity();
            return true;
        } catch (CertificateExpiredException error) {
            showConnectionError("内置的 SakuraFrp 证书已过期，请更新应用中的联机证书。");
        } catch (CertificateNotYetValidException error) {
            showConnectionError("内置的 SakuraFrp 证书尚未生效，请检查手机日期和时间。");
        } catch (Exception error) {
            showConnectionError("无法读取内置的 SakuraFrp 联机证书，请更新应用。");
        }
        return false;
    }

    private void connectToHost(String value) {
        String target = normalizeServerUrl(value);
        if (target == null) {
            Toast.makeText(this, "请输入有效的 HTTP 或 HTTPS 游戏邀请链接", Toast.LENGTH_LONG).show();
            return;
        }
        Uri uri = Uri.parse(target);
        connectionErrorShown = false;
        if (!checkSakuraCertificate(uri)) return;
        activeOrigin = uri.getScheme() + "://" + uri.getEncodedAuthority();
        webView.loadUrl(target);
    }

    private void showConnectDialog() {
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setHint("粘贴房主的完整邀请链接");
        LinearLayout container = new LinearLayout(this);
        container.setPadding(32, 8, 32, 0);
        container.addView(input);
        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("应用内联机")
                .setMessage("粘贴房主的 HTTP/HTTPS 邀请链接，支持内网穿透、局域网和虚拟组网，将直接在应用内进入游戏。返回键可回到本机游戏。")
                .setView(container)
                .setNegativeButton("取消", null)
                .setNeutralButton("返回本机游戏", (d, which) -> {
                    activeOrigin = localOrigin();
                    returningLocal = true;
                    webView.loadUrl(activeOrigin + "/");
                })
                .setPositiveButton("连接", null)
                .create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            if (normalizeServerUrl(input.getText().toString()) == null) {
                input.setError("请粘贴有效的 HTTP 或 HTTPS 游戏邀请链接");
                return;
            }
            String value = input.getText().toString();
            dialog.dismiss();
            connectToHost(value);
        }));
        dialog.show();
    }

    public final class GameBridge {
        @JavascriptInterface public String loadNickname() {
            return getSharedPreferences("game-preferences", MODE_PRIVATE).getString("nickname", "");
        }
        @JavascriptInterface public boolean saveNickname(String value) {
            if (value == null || value.length() > 64) return false;
            return getSharedPreferences("game-preferences", MODE_PRIVATE)
                    .edit().putString("nickname", value).commit();
        }
        @JavascriptInterface public String loadLoadout() {
            return getSharedPreferences("game-preferences", MODE_PRIVATE).getString("loadout", "");
        }
        @JavascriptInterface public boolean saveLoadout(String value) {
            if (value == null || value.length() > 256 * 1024) return false;
            try {
                org.json.JSONObject parsed = new org.json.JSONObject(value);
                if (!(parsed.opt("entries") instanceof org.json.JSONObject)) return false;
                // Commit before returning: closing/killing the app must not lose the last edit.
                return getSharedPreferences("game-preferences", MODE_PRIVATE)
                        .edit().putString("loadout", value).commit();
            } catch (org.json.JSONException error) { return false; }
        }
        @JavascriptInterface public String loadMatchHistory() {
            return getSharedPreferences("game-preferences", MODE_PRIVATE).getString("match-history", "");
        }
        @JavascriptInterface public boolean saveMatchHistory(String value) {
            if (value == null || value.length() > 4 * 1024 * 1024) return false;
            try {
                org.json.JSONObject parsed = new org.json.JSONObject(value);
                org.json.JSONArray records = parsed.optJSONArray("records");
                if (parsed.optInt("v") != 1 || records == null || records.length() > 20) return false;
                return getSharedPreferences("game-preferences", MODE_PRIVATE)
                        .edit().putString("match-history", value).commit();
            } catch (org.json.JSONException error) { return false; }
        }
        @JavascriptInterface public String loadPreference(String key) {
            if (activeOrigin == null || !activeOrigin.equals(localOrigin()) || !isNativePreferenceKey(key)) return "";
            return getSharedPreferences("game-preferences", MODE_PRIVATE).getString("pref:" + key, "");
        }
        @JavascriptInterface public boolean savePreference(String key, String value) {
            if (activeOrigin == null || !activeOrigin.equals(localOrigin()) || !isNativePreferenceKey(key)
                    || value == null || value.length() > 512 * 1024) return false;
            try {
                new org.json.JSONTokener(value).nextValue();
                return getSharedPreferences("game-preferences", MODE_PRIVATE)
                        .edit().putString("pref:" + key, value).commit();
            } catch (org.json.JSONException error) { return false; }
        }
        private boolean isNativePreferenceKey(String key) {
            return "settings".equals(key) || "shopCollapsed".equals(key);
        }
        @JavascriptInterface public String loadStats() {
            if (activeOrigin == null || !activeOrigin.equals(localOrigin())) return "";
            return getSharedPreferences("game-preferences", MODE_PRIVATE).getString("stats", "");
        }
        @JavascriptInterface public boolean saveStats(String value) {
            if (activeOrigin == null || !activeOrigin.equals(localOrigin())) return false;
            if (value == null || value.length() > 1_600_000) return false;
            try {
                org.json.JSONObject parsed = new org.json.JSONObject(value);
                org.json.JSONArray records = parsed.optJSONArray("records");
                int version = parsed.optInt("v");
                if (version < 1 || version > 2 || records == null || records.length() > 1000) return false;
                return getSharedPreferences("game-preferences", MODE_PRIVATE)
                        .edit().putString("stats", value).commit();
            } catch (org.json.JSONException error) { return false; }
        }
        @JavascriptInterface public String lanOrigin() { return MainActivity.this.lanOrigin(); }
        @JavascriptInterface public String safeInsets() { return cachedSafeInsets; }
        @JavascriptInterface public String overlayOrigin() { return MainActivity.this.networkOrigin(true); }
        @JavascriptInterface public void connectToHost() { ui.post(MainActivity.this::showConnectDialog); }
        @JavascriptInterface public void connectToHostUrl(String url) { ui.post(() -> MainActivity.this.connectToHost(url)); }
    }

    private void showError(String message) {
        if (failed || isFinishing()) return;
        failed = true;
        starting = false;
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setBackgroundColor(0xff0c0f0e);
        panel.setPadding(32, 24, 32, 24);
        TextView text = new TextView(this);
        text.setText(message);
        text.setTextColor(0xffffc7b5);
        text.setTextSize(17);
        text.setGravity(Gravity.CENTER);
        panel.addView(text);
        Button close = new Button(this);
        close.setText("退出应用");
        close.setOnClickListener(v -> finish());
        panel.addView(close);
        setContentView(panel);
    }

    @Override protected void onDestroy() {
        super.onDestroy();
        if (isFinishing()) android.os.Process.killProcess(android.os.Process.myPid());
    }

    @Override public void onBackPressed() {
        if (webView != null && activeOrigin != null && !activeOrigin.equals(localOrigin())) {
            activeOrigin = localOrigin();
            returningLocal = true;
            webView.loadUrl(activeOrigin + "/");
        } else if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
}
