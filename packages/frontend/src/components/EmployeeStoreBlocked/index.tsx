import { View, Text } from '@tarojs/components';
import { useTranslation } from '../../i18n';

/**
 * Full-page blocked view shown when employee store access is disabled.
 * Displays a friendly message instead of store content.
 */
export default function EmployeeStoreBlocked() {
  const { t } = useTranslation();

  return (
    <View style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 'var(--space-48) var(--space-24)',
      textAlign: 'center',
      minHeight: '60vh',
    }}>
      <Text style={{ fontSize: '48px', marginBottom: 'var(--space-16)', opacity: 0.5 }}>🔒</Text>
      <Text style={{
        fontFamily: 'var(--font-display)',
        fontSize: '18px',
        fontWeight: 600,
        color: 'var(--text-primary)',
        marginBottom: 'var(--space-8)',
      }}>{t('store.employeeBlocked.title' as any)}</Text>
      <Text style={{
        fontFamily: 'var(--font-body)',
        fontSize: '14px',
        color: 'var(--text-secondary)',
        lineHeight: 1.5,
      }}>{t('store.employeeBlocked.description' as any)}</Text>
    </View>
  );
}
