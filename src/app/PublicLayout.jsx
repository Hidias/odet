import { GraduationCap } from 'lucide-react'

export default function PublicLayout({ children }) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header simple */}
      <header className="bg-white border-b border-gray-200" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-gray-900">Access Formation</span>
          </div>
        </div>
      </header>
      
      {/* Content */}
      <main className="max-w-3xl mx-auto px-4 py-8">
        {children}
      </main>
      
      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white mt-auto" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="max-w-3xl mx-auto px-4 py-4 text-center text-sm text-gray-500">
          © {new Date().getFullYear()} Access Formation. Tous droits réservés.
        </div>
      </footer>
    </div>
  )
}
