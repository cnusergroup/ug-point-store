import { View, Text } from '@tarojs/components';
import { useTranslation } from '../../i18n';

interface ForbiddenViewProps {
  onBack: () => void;
}

/**
 * Full-page locked/forbidden view shown when a user lacks permission to access a page.
 */
export default function ForbiddenView({ onBack }: ForbiddenViewProps) {
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
      }}>{t('featureToggle.featureDisabled')}</Text>
      <Text style={{
        fontFamily: 'var(--font-body)',
        fontSize: '14px',
        color: 'var(--text-secondary)',
        marginBottom: 'var(--space-32)',
        lineHeight: 1.5,
      }}>{t('featureToggle.featureDisabledDesc')}</Text>
      <View
        className='btn-secondary'
        style={{ padding: 'var(--space-12) var(--space-32)', cursor: 'pointer' }}
        onClick={onBack}
      >
        <Text>{t('featureToggle.backButton')}</Text>
      </View>
    </View>
  );
}
