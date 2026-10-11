import { useState } from 'react'
import { CheckCircle, AlertCircle, ChevronLeft, ChevronRight, HelpCircle } from 'lucide-react'

export default function PositioningTestForm({ questions, traineeId, onComplete }) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState({})
  const [showConfirmation, setShowConfirmation] = useState(false)

  const currentQuestion = questions[currentIndex]
  const progress = ((currentIndex + 1) / questions.length) * 100
  const isLastQuestion = currentIndex === questions.length - 1
  const canGoNext = currentIndex < questions.length - 1
  const canGoPrevious = currentIndex > 0

  const handleAnswer = (value) => {
    setAnswers({
      ...answers,
      [currentQuestion.id]: value
    })
  }

  const handleNext = () => {
    if (canGoNext) {
      setCurrentIndex(currentIndex + 1)
    }
  }

  const handlePrevious = () => {
    if (canGoPrevious) {
      setCurrentIndex(currentIndex - 1)
    }
  }

  const handleFinish = () => {
    setShowConfirmation(true)
  }

  const handleConfirmSubmit = () => {
    // Construire le tableau de réponses pour la RPC
    const formattedAnswers = questions.map(q => ({
      question_id: q.id,
      question_type: q.question_type,
      selected_option_index: q.question_type === 'single_choice' 
        ? (answers[q.id]?.selectedIndex ?? null)
        : null,
      text_answer: q.question_type === 'open'
        ? (answers[q.id] || null)
        : null
    }))

    onComplete(formattedAnswers)
  }

  const getAnsweredCount = () => {
    return Object.keys(answers).filter(key => {
      const answer = answers[key]
      if (!answer) return false
      if (typeof answer === 'string') return answer.trim().length > 0
      return answer.selectedIndex !== undefined
    }).length
  }

  // Modal de confirmation
  if (showConfirmation) {
    const answeredCount = getAnsweredCount()
    const unansweredCount = questions.length - answeredCount

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl p-6 max-w-md w-full">
          <h3 className="text-xl font-bold text-gray-900 mb-4">
            Terminer le test de positionnement ?
          </h3>
          
          <div className="space-y-3 mb-6">
            <p className="text-sm text-gray-600">
              <strong>{answeredCount}</strong> question{answeredCount > 1 ? 's' : ''} répondue{answeredCount > 1 ? 's' : ''}
            </p>
            {unansweredCount > 0 && (
              <div className="flex items-start gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                <AlertCircle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-orange-800">
                  <strong>{unansweredCount}</strong> question{unansweredCount > 1 ? 's non répondues' : ' non répondue'}. 
                  Vous pouvez revenir en arrière pour y répondre.
                </p>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setShowConfirmation(false)}
              className="flex-1 px-4 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium"
            >
              Continuer le test
            </button>
            <button
              onClick={handleConfirmSubmit}
              className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
            >
              Valider mes réponses
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* En-tête avec progression */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-gray-900">
            🎓 Test de positionnement
          </h2>
          <span className="text-sm font-medium text-blue-600">
            Question {currentIndex + 1} sur {questions.length}
          </span>
        </div>
        
        {/* Barre de progression */}
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div 
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Question */}
      <div className="bg-white border-2 border-blue-200 rounded-xl p-6 min-h-[400px] flex flex-col">
        <div className="flex-1">
          <div className="flex items-start gap-3 mb-6">
            <div className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
              {currentIndex + 1}
            </div>
            <div className="flex-1">
              <p className="text-lg font-medium text-gray-900 leading-relaxed">
                {currentQuestion.question_text}
              </p>
            </div>
          </div>

          {/* QCM */}
          {currentQuestion.question_type === 'single_choice' && (() => {
            // Parser options de manière robuste
            let options = []
            try {
              if (typeof currentQuestion.options === 'string') {
                options = JSON.parse(currentQuestion.options)
              } else if (Array.isArray(currentQuestion.options)) {
                options = currentQuestion.options
              }
            } catch (e) {
              console.error('Erreur parsing options:', e)
              options = []
            }
            
            return (
              <div className="space-y-3">
                {options.map((option, index) => {
                  const isSelected = answers[currentQuestion.id]?.selectedIndex === index
                  
                  return (
                    <button
                      key={index}
                      type="button"
                      onClick={() => handleAnswer({ selectedIndex: index })}
                      className={`w-full p-4 text-left border-2 rounded-xl transition-all duration-200 ${
                        isSelected
                          ? 'border-blue-500 bg-blue-600 text-white shadow-md shadow-blue-200'
                          : 'border-gray-200 bg-white text-gray-900 hover:border-blue-300 hover:bg-blue-50'
                      }`}
                    >
                      <span className={isSelected ? 'font-medium' : ''}>{option}</span>
                    </button>
                  )
                })}
                
                {/* Option "Je ne sais pas" */}
                <button
                  type="button"
                  onClick={() => handleAnswer({ selectedIndex: -1 })}
                  className={`w-full p-4 text-left border-2 rounded-xl transition-all duration-200 ${
                    answers[currentQuestion.id]?.selectedIndex === -1
                      ? 'border-gray-400 bg-gray-600 text-white shadow-md shadow-gray-200'
                      : 'border-gray-200 bg-white hover:border-gray-400 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <HelpCircle className={`w-5 h-5 ${
                      answers[currentQuestion.id]?.selectedIndex === -1 
                        ? 'text-gray-200' 
                        : 'text-gray-400'
                    }`} />
                    <span className="italic">Je ne sais pas</span>
                  </div>
                </button>
              </div>
            )
          })()}

          {/* Question ouverte */}
          {currentQuestion.question_type === 'open' && (
            <div>
              <textarea
                value={answers[currentQuestion.id] || ''}
                onChange={(e) => handleAnswer(e.target.value)}
                placeholder="Écrivez votre réponse ici..."
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[200px] text-gray-900"
              />
              <p className="text-xs text-gray-500 mt-2">
                Prenez le temps de détailler votre réponse
              </p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between gap-4 mt-6 pt-6 border-t">
          <button
            type="button"
            onClick={handlePrevious}
            disabled={!canGoPrevious}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition ${
              canGoPrevious
                ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                : 'bg-gray-50 text-gray-300 cursor-not-allowed'
            }`}
          >
            <ChevronLeft className="w-5 h-5" />
            Précédent
          </button>

          {!isLastQuestion ? (
            <button
              type="button"
              onClick={handleNext}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition"
            >
              Suivant
              <ChevronRight className="w-5 h-5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinish}
              className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium transition"
            >
              <CheckCircle className="w-5 h-5" />
              Terminer le test
            </button>
          )}
        </div>
      </div>

      {/* Indicateur de réponses */}
      <div className="flex items-center justify-center gap-2 flex-wrap">
        {questions.map((q, idx) => {
          const hasAnswer = answers[q.id] !== undefined && (
            typeof answers[q.id] === 'string' 
              ? answers[q.id].trim().length > 0
              : answers[q.id].selectedIndex !== undefined
          )
          
          return (
            <button
              key={q.id}
              type="button"
              onClick={() => setCurrentIndex(idx)}
              className={`w-8 h-8 rounded-full text-xs font-medium transition ${
                idx === currentIndex
                  ? 'bg-blue-600 text-white ring-2 ring-blue-300'
                  : hasAnswer
                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {idx + 1}
            </button>
          )
        })}
      </div>
    </div>
  )
}
