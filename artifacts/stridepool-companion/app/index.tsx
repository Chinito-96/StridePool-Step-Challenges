import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import StridePoolHealth, { type HealthSource } from 'stridepool-health';
import { useColors } from '@/hooks/useColors';

type BridgeRequest = {
  channel: 'stridepool-health';
  id: string;
  documentId: string;
  method: 'requestPermissions' | 'getPermissionStatus' | 'readStepSamples' | 'openSettings';
  source: HealthSource;
  since?: string;
};

const methods = new Set<BridgeRequest['method']>(['requestPermissions', 'getPermissionStatus', 'readStepSamples', 'openSettings']);

function isTrustedUrl(value: string, trustedOrigin: string): boolean {
  try {
    return new URL(value).origin === trustedOrigin;
  } catch {
    return false;
  }
}

function isBridgeRequest(value: unknown): value is BridgeRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<BridgeRequest>;
  return request.channel === 'stridepool-health'
    && typeof request.id === 'string'
    && request.id.length > 0
    && request.id.length <= 100
    && typeof request.documentId === 'string'
    && request.documentId.length > 0
    && request.documentId.length <= 100
    && typeof request.method === 'string'
    && methods.has(request.method as BridgeRequest['method'])
    && (request.source === 'apple_health' || request.source === 'health_connect')
    && (request.since === undefined || (typeof request.since === 'string' && Number.isFinite(Date.parse(request.since))));
}

const bridgeScript = `
(() => {
  const pending = new Map();
  let sequence = 0;
  const documentId = String(Date.now()) + '-' + String(Math.random()).slice(2);
  window.__stridePoolHealthDocumentId = documentId;
  const invoke = (method, source, since) => new Promise((resolve, reject) => {
    const id = String(Date.now()) + '-' + String(++sequence);
    pending.set(id, { resolve, reject });
    window.ReactNativeWebView.postMessage(JSON.stringify({
      channel: 'stridepool-health', id, documentId, method, source, since
    }));
  });
  window.StridePoolHealth = {
    requestPermissions: (source) => invoke('requestPermissions', source),
    getPermissionStatus: (source) => invoke('getPermissionStatus', source),
    readStepSamples: (source, since) => invoke('readStepSamples', source, since),
    openSettings: (source) => invoke('openSettings', source)
  };
  window.addEventListener('stridepool-health-response', (event) => {
    const response = event.detail;
    const handler = pending.get(response.id);
    if (!handler) return;
    pending.delete(response.id);
    response.ok ? handler.resolve(response.result) : handler.reject(new Error(response.error));
  });
  true;
})();`;

export default function CompanionScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const webView = useRef<WebView>(null);
  const currentUrl = useRef('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  const uri = domain ? `https://${domain}/` : null;
  const trustedOrigin = domain ? `https://${domain}` : null;
  const styles = useMemo(() => createStyles(colors), [colors]);

  const respond = useCallback((id: string, documentId: string, ok: boolean, result?: unknown, error?: string) => {
    if (!trustedOrigin || !isTrustedUrl(currentUrl.current, trustedOrigin)) return;
    const detail = JSON.stringify({ id, documentId, ok, result, error }).replaceAll('\\', '\\\\').replaceAll("'", "\\'");
    const expectedOrigin = JSON.stringify(trustedOrigin);
    const expectedDocument = JSON.stringify(documentId);
    webView.current?.injectJavaScript(
      `if(location.origin===${expectedOrigin}&&window.__stridePoolHealthDocumentId===${expectedDocument}){window.dispatchEvent(new CustomEvent('stridepool-health-response',{detail:JSON.parse('${detail}')}));}true;`,
    );
  }, [trustedOrigin]);

  const onMessage = useCallback(async (event: WebViewMessageEvent) => {
    if (!trustedOrigin || !isTrustedUrl(event.nativeEvent.url, trustedOrigin)) return;
    let request: BridgeRequest;
    try {
      const parsed: unknown = JSON.parse(event.nativeEvent.data);
      if (!isBridgeRequest(parsed)) return;
      request = parsed;
    } catch {
      return;
    }
    try {
      let result: unknown;
      if (request.method === 'requestPermissions') result = await StridePoolHealth.requestPermissions(request.source);
      if (request.method === 'getPermissionStatus') result = await StridePoolHealth.getPermissionStatus(request.source);
      if (request.method === 'readStepSamples') result = await StridePoolHealth.readStepSamples(request.source, request.since);
      if (request.method === 'openSettings') {
        await Linking.openSettings();
        result = undefined;
      }
      respond(request.id, request.documentId, true, result);
    } catch (caught) {
      respond(request.id, request.documentId, false, undefined, caught instanceof Error ? caught.message : 'Native health request failed.');
    }
  }, [respond, trustedOrigin]);

  if (Platform.OS === 'web' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient || !uri) {
    return (
      <View style={[styles.fallback, { paddingTop: Platform.OS === 'web' ? 67 : insets.top, paddingBottom: Platform.OS === 'web' ? 34 : insets.bottom }]}>
        <View style={styles.mark}><Ionicons name="footsteps" size={36} color={colors.primaryForeground} /></View>
        <Text style={styles.title}>StridePool Companion</Text>
        <Text style={styles.body}>{Constants.executionEnvironment === ExecutionEnvironment.StoreClient ? 'Expo Go cannot load the native health modules. Install a StridePool development or release build to connect Apple Health or Health Connect.' : 'Open this app on an iPhone or Android device to connect Apple Health or Health Connect.'}</Text>
        <View style={styles.note}><Ionicons name="shield-checkmark" size={20} color={colors.foreground} /><Text style={styles.noteText}>Health permissions stay under device control. Step records are sent only after you sign in.</Text></View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar style="auto" />
      {loading && <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>Opening StridePool</Text></View>}
      {error && (
        <View style={styles.error}>
          <Ionicons name="cloud-offline-outline" size={30} color={colors.destructive} />
          <Text style={styles.title}>Couldn’t load StridePool</Text>
          <Text style={styles.body}>{error}</Text>
          <Pressable testID="button-retry" style={({ pressed }) => [styles.button, pressed && styles.pressed]} onPress={() => { setError(null); setLoading(true); webView.current?.reload(); }}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      )}
      <WebView
        ref={webView}
        source={{ uri }}
        injectedJavaScriptBeforeContentLoaded={bridgeScript}
        onMessage={onMessage}
        onLoadEnd={() => setLoading(false)}
        onNavigationStateChange={(state) => { currentUrl.current = state.url; }}
        onError={(event) => { setLoading(false); setError(event.nativeEvent.description); }}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        javaScriptEnabled
        style={[styles.webview, error && styles.hidden]}
      />
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    webview: { flex: 1, backgroundColor: colors.background },
    hidden: { display: 'none' },
    loading: { position: 'absolute', inset: 0, zIndex: 2, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.background },
    loadingText: { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
    fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 16, backgroundColor: colors.background },
    error: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 14, backgroundColor: colors.background },
    mark: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
    title: { color: colors.foreground, fontFamily: 'Inter_700Bold', fontSize: 26, textAlign: 'center' },
    body: { color: colors.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 24, textAlign: 'center' },
    note: { marginTop: 12, flexDirection: 'row', gap: 12, padding: 16, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
    noteText: { flex: 1, color: colors.foreground, fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
    button: { marginTop: 8, paddingHorizontal: 22, paddingVertical: 13, borderRadius: colors.radius, backgroundColor: colors.primary },
    pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
    buttonText: { color: colors.primaryForeground, fontFamily: 'Inter_700Bold', fontSize: 15 },
  });
}