import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';

import SegmentedControl from '../components/SegmentedControl';
import StatusView from '../components/StatusView';
import { extractErrorMessage } from '../services/api';
import { fetchFaq, submitSupportQuery } from '../services/supportService';
import { COLORS } from '../theme/colors';

type SupportTab = 'faq' | 'ask';

export default function HelpSupportScreen() {
  const navigation = useNavigation<any>();
  const [tab, setTab] = useState<SupportTab>('faq');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [faq, setFaq] = useState<Array<{ id: string; question: string; answer: string }>>([]);
  const [question, setQuestion] = useState('');

  useEffect(() => {
    if (tab === 'faq') {
      void loadFaq();
    }
  }, [tab]);

  const loadFaq = async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      setFaq(await fetchFaq());
    } catch (error) {
      setErrorMessage(extractErrorMessage(error, 'FAQ is unavailable right now'));
      setFaq([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAskSupport = async () => {
    if (!question.trim()) {
      Alert.alert('Question required', 'Enter your question first.');
      return;
    }
    try {
      setLoading(true);
      setErrorMessage(null);
      const response = await submitSupportQuery(question.trim());
      Alert.alert('Support reply', response.answer);
      setQuestion('');
    } catch (error) {
      const message = extractErrorMessage(error, 'Support is unavailable right now');
      setErrorMessage(message);
      Alert.alert('Support unavailable', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TEXT_PRIMARY} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Help & Support</Text>
        <View style={styles.headerButton} />
      </View>

      <SegmentedControl
        options={[
          { label: 'FAQ', value: 'faq' },
          { label: 'Ask Support', value: 'ask' },
        ]}
        value={tab}
        onChange={setTab}
      />

      <View style={styles.content}>
        {tab === 'faq' ? (
          loading ? (
            <StatusView type="loading" message="Loading FAQ..." />
          ) : errorMessage ? (
            <StatusView type="error" title="FAQ unavailable" message={errorMessage} onRetry={() => void loadFaq()} />
          ) : faq.length === 0 ? (
            <StatusView type="empty" title="No FAQ data yet" message="FAQ content will render here once the support backend is available." />
          ) : (
            <ScrollView contentContainerStyle={styles.listContent}>
              {faq.map((item) => (
                <View key={item.id} style={styles.card}>
                  <Text style={styles.cardTitle}>{item.question}</Text>
                  <Text style={styles.cardSubtitle}>{item.answer}</Text>
                </View>
              ))}
            </ScrollView>
          )
        ) : (
          <ScrollView contentContainerStyle={styles.askContent}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Ask Support</Text>
              <Text style={styles.cardSubtitle}>
                This screen is wired for the real `/support/query` backend. No canned responses are shipped.
              </Text>
              <TextInput
                style={styles.input}
                value={question}
                onChangeText={setQuestion}
                placeholder="Describe your issue"
                placeholderTextColor={COLORS.TEXT_MUTED}
                multiline
              />
              <TouchableOpacity style={styles.primaryButton} onPress={() => void handleAskSupport()} disabled={loading}>
                {loading ? <ActivityIndicator size="small" color={COLORS.WHITE} /> : <Text style={styles.primaryButtonText}>Submit</Text>}
              </TouchableOpacity>
              {errorMessage ? <Text style={styles.inlineError}>{errorMessage}</Text> : null}
            </View>
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.BACKGROUND,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  content: {
    flex: 1,
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  askContent: {
    padding: 16,
  },
  card: {
    backgroundColor: COLORS.SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    padding: 16,
    gap: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  cardSubtitle: {
    fontSize: 13,
    color: COLORS.TEXT_SECONDARY,
    lineHeight: 20,
  },
  input: {
    minHeight: 120,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.BACKGROUND,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: COLORS.TEXT_PRIMARY,
    textAlignVertical: 'top',
  },
  primaryButton: {
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: COLORS.WHITE,
    fontSize: 13,
    fontWeight: '700',
  },
  inlineError: {
    fontSize: 12,
    color: COLORS.DANGER,
  },
});
