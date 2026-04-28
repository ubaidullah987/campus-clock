tailwind.config = {
    theme: {
        extend: {
            fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'], mono: ['JetBrains Mono', 'monospace'] },
            colors: {
                background: '#FAFAFA', 
                surface: '#FFFFFF',
                border: '#E4E4E7', 
                primary: '#09090B', 
                muted: '#71717A', 
            },
            boxShadow: {
                'soft': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                'floating': '0 10px 40px -10px rgba(0,0,0,0.08)',
            }
        }
    }
};
