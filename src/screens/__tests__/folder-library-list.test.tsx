jest.mock('../../store/persistence/kvStorage', () =>
  require('../../store/persistence/__mocks__/kvStorage'),
);

jest.mock('expo-router/react-navigation', () => ({ useIsFocused: () => true }));

jest.mock('@shopify/flash-list', () => {
  const { View } = require('react-native');
  return {
    FlashList: ({ data, renderItem, keyExtractor, ListHeaderComponent, ListEmptyComponent }: any) => (
      <View>
        {ListHeaderComponent}
        {data.length === 0 && ListEmptyComponent}
        {data.map((item: any) => (
          <View key={keyExtractor(item)}>{renderItem({ item })}</View>
        ))}
      </View>
    ),
  };
});

jest.mock('../../components/EmptyState', () => {
  const { Text, View } = require('react-native');
  return {
    EmptyState: ({ title, subtitle, children }: any) => (
      <View>
        <Text>{title}</Text>
        {subtitle && <Text>{subtitle}</Text>}
        {children}
      </View>
    ),
  };
});

jest.mock('../../components/TrackRow', () => {
  const { Text } = require('react-native');
  return { TrackRow: ({ track }: any) => <Text>{`track:${track.title}`}</Text> };
});

const mockGetMusicFolders = jest.fn();
const mockGetFolderIndexes = jest.fn();
const mockGetMusicDirectory = jest.fn();
jest.mock('../../services/subsonicService', () => ({
  getMusicFolders: (...args: unknown[]) => mockGetMusicFolders(...args),
  getFolderIndexes: (...args: unknown[]) => mockGetFolderIndexes(...args),
  getMusicDirectory: (...args: unknown[]) => mockGetMusicDirectory(...args),
}));

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { offlineModeStore } from '../../store/offlineModeStore';
import { FolderLibraryListScreen } from '../folder-library-list';

const song = (id: string, title: string) => ({ id, title, isDir: false }) as any;

beforeEach(() => {
  jest.clearAllMocks();
  offlineModeStore.setState({ offlineMode: false });
});

describe('FolderLibraryListScreen', () => {
  it('lists music folders when the server has more than one', async () => {
    mockGetMusicFolders.mockResolvedValue([
      { id: 1, name: 'Music' },
      { id: 2, name: 'Audiobooks' },
    ]);
    const screen = render(<FolderLibraryListScreen />);
    await waitFor(() => expect(screen.getByText('Music')).toBeTruthy());
    expect(screen.getByText('Audiobooks')).toBeTruthy();
    expect(mockGetFolderIndexes).not.toHaveBeenCalled();
  });

  it('opens a single music folder directly without a parent row', async () => {
    mockGetMusicFolders.mockResolvedValue([{ id: 7, name: 'Music' }]);
    mockGetFolderIndexes.mockResolvedValue({ folders: [{ id: 'a1', name: 'Pink Floyd' }], songs: [] });
    const screen = render(<FolderLibraryListScreen />);
    await waitFor(() => expect(screen.getByText('Pink Floyd')).toBeTruthy());
    expect(mockGetFolderIndexes).toHaveBeenCalledWith('7');
    expect(screen.queryByText('..')).toBeNull();
  });

  it('opens directories, lists songs, and navigates back up', async () => {
    mockGetMusicFolders.mockResolvedValue([{ id: 7, name: 'Music' }]);
    mockGetFolderIndexes.mockResolvedValue({ folders: [{ id: 'a1', name: 'Pink Floyd' }], songs: [] });
    mockGetMusicDirectory.mockImplementation(async (id: string) =>
      id === 'a1'
        ? { folders: [{ id: 'al1', name: 'The Wall' }], songs: [] }
        : { folders: [], songs: [song('s1', 'In the Flesh?')] },
    );

    const screen = render(<FolderLibraryListScreen />);
    await waitFor(() => expect(screen.getByText('Pink Floyd')).toBeTruthy());
    fireEvent.press(screen.getByText('Pink Floyd'));
    await waitFor(() => expect(screen.getByText('The Wall')).toBeTruthy());
    expect(mockGetMusicDirectory).toHaveBeenCalledWith('a1');

    fireEvent.press(screen.getByText('The Wall'));
    await waitFor(() => expect(screen.getByText('track:In the Flesh?')).toBeTruthy());
    expect(mockGetMusicDirectory).toHaveBeenCalledWith('al1');

    fireEvent.press(screen.getByText('..'));
    await waitFor(() => expect(screen.getByText('The Wall')).toBeTruthy());
    expect(mockGetMusicDirectory).toHaveBeenCalledTimes(2);
  });

  it('shows server errors and retries the request', async () => {
    mockGetMusicFolders.mockRejectedValueOnce(new Error('server error'));
    mockGetMusicFolders.mockResolvedValueOnce([{ id: 1, name: 'Music' }, { id: 2, name: 'Other' }]);
    const screen = render(<FolderLibraryListScreen />);
    await waitFor(() => expect(screen.getByText('server error')).toBeTruthy());
    fireEvent.press(screen.getByText('Retry'));
    await waitFor(() => expect(screen.getByText('Other')).toBeTruthy());
  });

  it('does not request server folders while offline', async () => {
    offlineModeStore.setState({ offlineMode: true });
    const screen = render(<FolderLibraryListScreen />);
    await waitFor(() => expect(screen.getByText('Not available offline')).toBeTruthy());
    expect(mockGetMusicFolders).not.toHaveBeenCalled();
  });
});
