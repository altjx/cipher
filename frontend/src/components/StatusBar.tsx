interface StatusBarProps {
  phoneStatus: 'connected' | 'offline' | 'reconnecting' | null;
  wsConnected: boolean;
}

export default function StatusBar({ phoneStatus, wsConnected }: StatusBarProps) {
  const showPhoneWarning = phoneStatus === 'offline' || phoneStatus === 'reconnecting';
  const showWsWarning = !wsConnected;
  const visible = showPhoneWarning || showWsWarning;

  let bgColor = '';
  let text = '';

  if (showWsWarning) {
    bgColor = 'bg-red-700';
    text = 'Disconnected from server. Reconnecting...';
  } else if (showPhoneWarning) {
    bgColor = 'bg-yellow-600';
    text = phoneStatus === 'offline'
      ? 'Phone is offline. Messages may be delayed.'
      : 'Reconnecting to phone...';
  }

  return (
    <div
      className={`overflow-hidden transition-all duration-300 ease-in-out ${visible ? 'max-h-10' : 'max-h-0'}`}
    >
      {visible && (
        <div className={`${bgColor} text-white text-center text-sm py-1.5 px-4`}>
          {text}
        </div>
      )}
    </div>
  );
}
