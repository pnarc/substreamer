import Ionicons from '@react-native-vector-icons/ionicons/static';
import { FlashList } from '@shopify/flash-list';
import { useIsFocused } from 'expo-router/react-navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '../components/EmptyState';
import { TrackRow } from '../components/TrackRow';
import { LIST_DRAW_DISTANCE } from '../constants/layout';
import { useTheme } from '../hooks/useTheme';
import { minDelay } from '../utils/stringHelpers';
import {
  getFolderIndexes,
  getMusicDirectory,
  getMusicFolders,
  type Child,
  type FolderEntry,
} from '../services/subsonicService';
import { offlineModeStore } from '../store/offlineModeStore';

type Level =
  | { kind: 'folders' }
  | { kind: 'indexes'; id: string; name: string }
  | { kind: 'directory'; id: string; name: string };

type LevelContent = {
  folders: FolderEntry[];
  songs: Child[];
  childKind: 'indexes' | 'directory';
};

type Row =
  | { type: 'up'; key: string; name: string }
  | { type: 'folder'; key: string; entry: FolderEntry; levelKind: 'indexes' | 'directory' }
  | { type: 'song'; key: string; track: Child };

const levelKey = (level: Level) =>
  level.kind === 'folders' ? 'folders' : `${level.kind}:${level.id}`;

async function loadLevel(level: Level): Promise<LevelContent> {
  if (level.kind === 'folders') {
    const musicFolders = await getMusicFolders();
    return {
      folders: musicFolders.map((folder) => ({
        id: String(folder.id),
        name: folder.name ?? String(folder.id),
      })),
      songs: [],
      childKind: 'indexes',
    };
  }
  if (level.kind === 'indexes') {
    return { ...(await getFolderIndexes(level.id)), childKind: 'directory' };
  }
  return { ...(await getMusicDirectory(level.id)), childKind: 'directory' };
}

export function FolderLibraryListScreen({ contentInsetTop = 0 }: { contentInsetTop?: number }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const isFocused = useIsFocused();
  const offlineMode = offlineModeStore((s) => s.offlineMode);
  const [stack, setStack] = useState<Level[]>([{ kind: 'folders' }]);
  const [loaded, setLoaded] = useState<{ key: string; data: LevelContent } | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const cacheRef = useRef<Map<string, LevelContent>>(new Map());
  const requestRef = useRef(0);

  const current = stack[stack.length - 1];
  const currentKey = levelKey(current);
  const content = loaded?.key === currentKey ? loaded.data : null;
  const error = failed?.key === currentKey ? failed.message : null;

  const fetchLevel = useCallback(async (level: Level, force: boolean) => {
    const key = levelKey(level);
    const request = ++requestRef.current;
    const cached = force ? undefined : cacheRef.current.get(key);
    if (cached) {
      setFailed(null);
      setLoaded({ key, data: cached });
      return;
    }
    setFailed(null);
    try {
      const result = await loadLevel(level);
      if (request !== requestRef.current) return;
      cacheRef.current.set(key, result);
      if (level.kind === 'folders' && result.folders.length === 1) {
        const only = result.folders[0];
        setStack([{ kind: 'folders' }, { kind: 'indexes', id: only.id, name: only.name }]);
        return;
      }
      setLoaded({ key, data: result });
    } catch (e) {
      if (request !== requestRef.current) return;
      setFailed({ key, message: e instanceof Error ? e.message : t('unknownError') });
    }
  }, [t]);

  useEffect(() => {
    if (!offlineMode) fetchLevel(current, false);
  }, [current, offlineMode, fetchLevel]);

  const cachedRoot = cacheRef.current.get('folders');
  const rootDepth = cachedRoot?.folders.length === 1 ? 1 : 0;
  const canGoUp = stack.length - 1 > rootDepth;

  const goUp = useCallback(() => {
    setStack((levels) => levels.length - 1 > rootDepth ? levels.slice(0, -1) : levels);
  }, [rootDepth]);

  useEffect(() => {
    if (!isFocused || !canGoUp) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      goUp();
      return true;
    });
    return () => subscription.remove();
  }, [isFocused, canGoUp, goUp]);

  const openFolder = useCallback((entry: FolderEntry, kind: 'indexes' | 'directory') => {
    setStack((levels) => [...levels, { kind, id: entry.id, name: entry.name }]);
  }, []);

  const rows = useMemo<Row[]>(() => {
    if (!content) return [];
    const result: Row[] = [];
    if (canGoUp) {
      const parent = stack[stack.length - 2];
      result.push({ type: 'up', key: 'up', name: parent.kind === 'folders' ? t('folders') : parent.name });
    }
    for (const entry of content.folders) {
      result.push({ type: 'folder', key: `f:${entry.id}`, entry, levelKind: content.childKind });
    }
    for (const track of content.songs) result.push({ type: 'song', key: `s:${track.id}`, track });
    return result;
  }, [content, canGoUp, stack, t]);

  const renderItem = useCallback(({ item }: { item: Row }) => {
    if (item.type === 'up') {
      return (
        <Pressable onPress={goUp} style={styles.row} android_ripple={{ color: colors.border }}>
          <Ionicons name="arrow-up" size={26} color={colors.primary} style={styles.icon} />
          <View style={styles.text}>
            <Text style={[styles.name, { color: colors.textPrimary }]} numberOfLines={1}>..</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>{item.name}</Text>
          </View>
        </Pressable>
      );
    }
    if (item.type === 'folder') {
      return (
        <Pressable
          onPress={() => openFolder(item.entry, item.levelKind)}
          style={styles.row}
          android_ripple={{ color: colors.border }}
        >
          <Ionicons name="folder" size={26} color={colors.primary} style={styles.icon} />
          <View style={styles.text}>
            <Text style={[styles.name, { color: colors.textPrimary }]} numberOfLines={1}>
              {item.entry.name}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </Pressable>
      );
    }
    return <TrackRow track={item.track} colors={colors} songs={content?.songs} showCoverArt />;
  }, [colors, content?.songs, goUp, openFolder]);

  const keyExtractor = useCallback((item: Row) => item.key, []);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const delay = minDelay();
    await fetchLevel(current, true);
    await delay;
    setRefreshing(false);
  }, [current, fetchLevel]);
  const inset = <View style={{ height: contentInsetTop }} />;

  if (offlineMode) {
    return (
      <View style={[styles.center, { paddingTop: contentInsetTop }]}>
        <EmptyState
          icon="cloud-offline-outline"
          title={t('notAvailableOffline')}
          subtitle={t('foldersNotAvailableOffline')}
        />
      </View>
    );
  }
  if (!content && !error) {
    return <View style={[styles.center, { paddingTop: contentInsetTop }]}><ActivityIndicator color={colors.primary} size="large" /></View>;
  }
  if (error) {
    return (
      <View style={[styles.center, { paddingTop: contentInsetTop }]}>
        <EmptyState icon="alert-circle-outline" title={t('error')} subtitle={error}>
          <Pressable onPress={() => fetchLevel(current, true)} style={styles.retry}>
            <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '600' }}>{t('retry')}</Text>
          </Pressable>
        </EmptyState>
        {canGoUp && <Pressable onPress={goUp} style={styles.retry}><Text style={{ color: colors.textSecondary }}>{t('back')}</Text></Pressable>}
      </View>
    );
  }
  return (
    <View style={styles.wrapper}>
      <FlashList
        key={currentKey}
        data={rows}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemType={(item) => item.type}
        drawDistance={LIST_DRAW_DISTANCE}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={inset}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
            progressViewOffset={contentInsetTop}
          />
        }
        ListEmptyComponent={<EmptyState icon="folder-open-outline" title={t('emptyFolder')} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { paddingBottom: 32 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16 },
  icon: { width: 32, textAlign: 'center' },
  text: { flex: 1, marginLeft: 12 },
  name: { fontSize: 16, fontWeight: '600' },
  subtitle: { fontSize: 12, marginTop: 2 },
  retry: { paddingVertical: 12, paddingHorizontal: 24, alignItems: 'center' },
});
