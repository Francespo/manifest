'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { ChevronDown, Paperclip, Search, Send, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export interface ContactFormData {
  firstName: string
  lastName: string
  countryId?: string
  countryCode?: string
  phoneNumber?: string
  email?: string
  message?: string
  attachment?: File | null
}

export interface ContactFormProps {
  data?: {
    title?: string
    subtitle?: string
    submitLabel?: string
    initialValues?: Partial<ContactFormData>
  }
  actions?: {
    onSubmit?: (data: ContactFormData) => void
  }
  appearance?: {
    showTitle?: boolean
  }
  control?: {
    isLoading?: boolean
  }
}

const countries = [
  { id: 'af', code: '+93', name: 'Afghanistan', flag: '🇦🇫' },
  { id: 'al', code: '+355', name: 'Albania', flag: '🇦🇱' },
  { id: 'dz', code: '+213', name: 'Algeria', flag: '🇩🇿' },
  { id: 'ar', code: '+54', name: 'Argentina', flag: '🇦🇷' },
  { id: 'am', code: '+374', name: 'Armenia', flag: '🇦🇲' },
  { id: 'au', code: '+61', name: 'Australia', flag: '🇦🇺' },
  { id: 'at', code: '+43', name: 'Austria', flag: '🇦🇹' },
  { id: 'az', code: '+994', name: 'Azerbaijan', flag: '🇦🇿' },
  { id: 'bh', code: '+973', name: 'Bahrain', flag: '🇧🇭' },
  { id: 'bd', code: '+880', name: 'Bangladesh', flag: '🇧🇩' },
  { id: 'by', code: '+375', name: 'Belarus', flag: '🇧🇾' },
  { id: 'be', code: '+32', name: 'Belgium', flag: '🇧🇪' },
  { id: 'bo', code: '+591', name: 'Bolivia', flag: '🇧🇴' },
  { id: 'ba', code: '+387', name: 'Bosnia', flag: '🇧🇦' },
  { id: 'br', code: '+55', name: 'Brazil', flag: '🇧🇷' },
  { id: 'bg', code: '+359', name: 'Bulgaria', flag: '🇧🇬' },
  { id: 'kh', code: '+855', name: 'Cambodia', flag: '🇰🇭' },
  { id: 'cm', code: '+237', name: 'Cameroon', flag: '🇨🇲' },
  { id: 'ca', code: '+1', name: 'Canada', flag: '🇨🇦' },
  { id: 'cl', code: '+56', name: 'Chile', flag: '🇨🇱' },
  { id: 'cn', code: '+86', name: 'China', flag: '🇨🇳' },
  { id: 'co', code: '+57', name: 'Colombia', flag: '🇨🇴' },
  { id: 'cr', code: '+506', name: 'Costa Rica', flag: '🇨🇷' },
  { id: 'hr', code: '+385', name: 'Croatia', flag: '🇭🇷' },
  { id: 'cu', code: '+53', name: 'Cuba', flag: '🇨🇺' },
  { id: 'cy', code: '+357', name: 'Cyprus', flag: '🇨🇾' },
  { id: 'cz', code: '+420', name: 'Czech Republic', flag: '🇨🇿' },
  { id: 'dk', code: '+45', name: 'Denmark', flag: '🇩🇰' },
  { id: 'do', code: '+1', name: 'Dominican Republic', flag: '🇩🇴' },
  { id: 'ec', code: '+593', name: 'Ecuador', flag: '🇪🇨' },
  { id: 'eg', code: '+20', name: 'Egypt', flag: '🇪🇬' },
  { id: 'sv', code: '+503', name: 'El Salvador', flag: '🇸🇻' },
  { id: 'ee', code: '+372', name: 'Estonia', flag: '🇪🇪' },
  { id: 'et', code: '+251', name: 'Ethiopia', flag: '🇪🇹' },
  { id: 'fi', code: '+358', name: 'Finland', flag: '🇫🇮' },
  { id: 'fr', code: '+33', name: 'France', flag: '🇫🇷' },
  { id: 'ge', code: '+995', name: 'Georgia', flag: '🇬🇪' },
  { id: 'de', code: '+49', name: 'Germany', flag: '🇩🇪' },
  { id: 'gh', code: '+233', name: 'Ghana', flag: '🇬🇭' },
  { id: 'gr', code: '+30', name: 'Greece', flag: '🇬🇷' },
  { id: 'gt', code: '+502', name: 'Guatemala', flag: '🇬🇹' },
  { id: 'hn', code: '+504', name: 'Honduras', flag: '🇭🇳' },
  { id: 'hk', code: '+852', name: 'Hong Kong', flag: '🇭🇰' },
  { id: 'hu', code: '+36', name: 'Hungary', flag: '🇭🇺' },
  { id: 'is', code: '+354', name: 'Iceland', flag: '🇮🇸' },
  { id: 'in', code: '+91', name: 'India', flag: '🇮🇳' },
  { id: 'id', code: '+62', name: 'Indonesia', flag: '🇮🇩' },
  { id: 'ir', code: '+98', name: 'Iran', flag: '🇮🇷' },
  { id: 'iq', code: '+964', name: 'Iraq', flag: '🇮🇶' },
  { id: 'ie', code: '+353', name: 'Ireland', flag: '🇮🇪' },
  { id: 'il', code: '+972', name: 'Israel', flag: '🇮🇱' },
  { id: 'it', code: '+39', name: 'Italy', flag: '🇮🇹' },
  { id: 'jm', code: '+1', name: 'Jamaica', flag: '🇯🇲' },
  { id: 'jp', code: '+81', name: 'Japan', flag: '🇯🇵' },
  { id: 'jo', code: '+962', name: 'Jordan', flag: '🇯🇴' },
  { id: 'kz', code: '+7', name: 'Kazakhstan', flag: '🇰🇿' },
  { id: 'ke', code: '+254', name: 'Kenya', flag: '🇰🇪' },
  { id: 'kw', code: '+965', name: 'Kuwait', flag: '🇰🇼' },
  { id: 'lv', code: '+371', name: 'Latvia', flag: '🇱🇻' },
  { id: 'lb', code: '+961', name: 'Lebanon', flag: '🇱🇧' },
  { id: 'lt', code: '+370', name: 'Lithuania', flag: '🇱🇹' },
  { id: 'lu', code: '+352', name: 'Luxembourg', flag: '🇱🇺' },
  { id: 'my', code: '+60', name: 'Malaysia', flag: '🇲🇾' },
  { id: 'mx', code: '+52', name: 'Mexico', flag: '🇲🇽' },
  { id: 'ma', code: '+212', name: 'Morocco', flag: '🇲🇦' },
  { id: 'mm', code: '+95', name: 'Myanmar', flag: '🇲🇲' },
  { id: 'np', code: '+977', name: 'Nepal', flag: '🇳🇵' },
  { id: 'nl', code: '+31', name: 'Netherlands', flag: '🇳🇱' },
  { id: 'nz', code: '+64', name: 'New Zealand', flag: '🇳🇿' },
  { id: 'ng', code: '+234', name: 'Nigeria', flag: '🇳🇬' },
  { id: 'no', code: '+47', name: 'Norway', flag: '🇳🇴' },
  { id: 'om', code: '+968', name: 'Oman', flag: '🇴🇲' },
  { id: 'pk', code: '+92', name: 'Pakistan', flag: '🇵🇰' },
  { id: 'pa', code: '+507', name: 'Panama', flag: '🇵🇦' },
  { id: 'py', code: '+595', name: 'Paraguay', flag: '🇵🇾' },
  { id: 'pe', code: '+51', name: 'Peru', flag: '🇵🇪' },
  { id: 'ph', code: '+63', name: 'Philippines', flag: '🇵🇭' },
  { id: 'pl', code: '+48', name: 'Poland', flag: '🇵🇱' },
  { id: 'pt', code: '+351', name: 'Portugal', flag: '🇵🇹' },
  { id: 'pr', code: '+1', name: 'Puerto Rico', flag: '🇵🇷' },
  { id: 'qa', code: '+974', name: 'Qatar', flag: '🇶🇦' },
  { id: 'ro', code: '+40', name: 'Romania', flag: '🇷🇴' },
  { id: 'ru', code: '+7', name: 'Russia', flag: '🇷🇺' },
  { id: 'sa', code: '+966', name: 'Saudi Arabia', flag: '🇸🇦' },
  { id: 'sn', code: '+221', name: 'Senegal', flag: '🇸🇳' },
  { id: 'rs', code: '+381', name: 'Serbia', flag: '🇷🇸' },
  { id: 'sg', code: '+65', name: 'Singapore', flag: '🇸🇬' },
  { id: 'sk', code: '+421', name: 'Slovakia', flag: '🇸🇰' },
  { id: 'si', code: '+386', name: 'Slovenia', flag: '🇸🇮' },
  { id: 'za', code: '+27', name: 'South Africa', flag: '🇿🇦' },
  { id: 'kr', code: '+82', name: 'South Korea', flag: '🇰🇷' },
  { id: 'es', code: '+34', name: 'Spain', flag: '🇪🇸' },
  { id: 'lk', code: '+94', name: 'Sri Lanka', flag: '🇱🇰' },
  { id: 'se', code: '+46', name: 'Sweden', flag: '🇸🇪' },
  { id: 'ch', code: '+41', name: 'Switzerland', flag: '🇨🇭' },
  { id: 'tw', code: '+886', name: 'Taiwan', flag: '🇹🇼' },
  { id: 'th', code: '+66', name: 'Thailand', flag: '🇹🇭' },
  { id: 'tn', code: '+216', name: 'Tunisia', flag: '🇹🇳' },
  { id: 'tr', code: '+90', name: 'Turkey', flag: '🇹🇷' },
  { id: 'ua', code: '+380', name: 'Ukraine', flag: '🇺🇦' },
  { id: 'ae', code: '+971', name: 'United Arab Emirates', flag: '🇦🇪' },
  { id: 'gb', code: '+44', name: 'United Kingdom', flag: '🇬🇧' },
  { id: 'us', code: '+1', name: 'United States', flag: '🇺🇸' },
  { id: 'uy', code: '+598', name: 'Uruguay', flag: '🇺🇾' },
  { id: 'uz', code: '+998', name: 'Uzbekistan', flag: '🇺🇿' },
  { id: 've', code: '+58', name: 'Venezuela', flag: '🇻🇪' },
  { id: 'vn', code: '+84', name: 'Vietnam', flag: '🇻🇳' },
  { id: 'ye', code: '+967', name: 'Yemen', flag: '🇾🇪' },
  { id: 'zm', code: '+260', name: 'Zambia', flag: '🇿🇲' },
  { id: 'zw', code: '+263', name: 'Zimbabwe', flag: '🇿🇼' }
]

export function ContactForm({
  data,
  actions,
  appearance,
  control
}: ContactFormProps) {
  const {
    title = 'Contact Us',
    subtitle = "Fill out the form below and we'll get back to you as soon as possible.",
    submitLabel = 'Send Message',
    initialValues
  } = data ?? {}
  const { onSubmit } = actions ?? {}
  const { showTitle = true } = appearance ?? {}
  const { isLoading = false } = control ?? {}

  const fileInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [formData, setFormData] = useState<ContactFormData>({
    firstName: initialValues?.firstName ?? '',
    lastName: initialValues?.lastName ?? '',
    countryId: initialValues?.countryId ?? 'us',
    countryCode: initialValues?.countryCode ?? '+1',
    phoneNumber: initialValues?.phoneNumber ?? '',
    email: initialValues?.email ?? '',
    message: initialValues?.message ?? '',
    attachment: initialValues?.attachment ?? null
  })
  const [countrySearch, setCountrySearch] = useState('')
  const [countryDropdownOpen, setCountryDropdownOpen] = useState(false)

  const selectedCountry = countries.find((c) => c.id === formData.countryId)

  const filteredCountries = countries.filter(
    (country) =>
      country.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
      country.code.includes(countrySearch)
  )

  useEffect(() => {
    if (countryDropdownOpen && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [countryDropdownOpen])

  const handleCountrySelect = (country: (typeof countries)[0]) => {
    setFormData((prev) => ({
      ...prev,
      countryId: country.id,
      countryCode: country.code
    }))
    setCountryDropdownOpen(false)
    setCountrySearch('')
  }

  const handleChange = (
    field: keyof ContactFormData,
    value: string | File | null
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null
    handleChange('attachment', file)
  }

  const handleRemoveFile = () => {
    handleChange('attachment', null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit?.(formData)
  }

  return (
    <div className="w-full bg-card rounded-xl p-6">
      {showTitle && (
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* First Name & Last Name */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="firstName">First Name</Label>
            <Input
              id="firstName"
              placeholder="John"
              value={formData.firstName}
              onChange={(e) => handleChange('firstName', e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName">Last Name</Label>
            <Input
              id="lastName"
              placeholder="Doe"
              value={formData.lastName}
              onChange={(e) => handleChange('lastName', e.target.value)}
              required
            />
          </div>
        </div>

        {/* Phone Number & Email */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="phone">Phone Number</Label>
            <div className="flex gap-2">
              <Popover
                open={countryDropdownOpen}
                onOpenChange={setCountryDropdownOpen}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'flex items-center gap-1.5 h-9 px-3 rounded-lg border border-input bg-transparent text-sm transition-colors',
                      'hover:bg-muted focus-visible:border-foreground focus-visible:outline-none'
                    )}
                  >
                    {selectedCountry && (
                      <>
                        <span>{selectedCountry.flag}</span>
                        <span>{selectedCountry.code}</span>
                      </>
                    )}
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[280px] p-0" align="start">
                  <div className="p-2 border-b border-border">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <input
                        ref={searchInputRef}
                        type="text"
                        placeholder="Search country..."
                        value={countrySearch}
                        onChange={(e) => setCountrySearch(e.target.value)}
                        className="w-full h-9 pl-9 pr-3 rounded-md border border-input bg-transparent text-sm placeholder:text-muted-foreground focus-visible:border-foreground focus-visible:outline-none"
                      />
                    </div>
                  </div>
                  <div className="max-h-[240px] overflow-y-auto p-1">
                    {filteredCountries.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No country found
                      </p>
                    ) : (
                      filteredCountries.map((country) => (
                        <button
                          key={country.id}
                          type="button"
                          onClick={() => handleCountrySelect(country)}
                          className={cn(
                            'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors text-left',
                            'hover:bg-muted',
                            formData.countryId === country.id && 'bg-muted'
                          )}
                        >
                          <span>{country.flag}</span>
                          <span className="flex-1">{country.name}</span>
                          <span className="text-muted-foreground">
                            {country.code}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </PopoverContent>
              </Popover>
              <Input
                id="phone"
                type="tel"
                placeholder="(555) 123-4567"
                value={formData.phoneNumber}
                onChange={(e) => handleChange('phoneNumber', e.target.value)}
                className="flex-1"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="john@example.com"
              value={formData.email}
              onChange={(e) => handleChange('email', e.target.value)}
              required
            />
          </div>
        </div>

        {/* Message */}
        <div className="space-y-2">
          <Label htmlFor="message">Tell us about your project</Label>
          <textarea
            id="message"
            placeholder="Describe your project, goals, and timeline..."
            value={formData.message}
            onChange={(e) => handleChange('message', e.target.value)}
            rows={4}
            required
            className={cn(
              'border-input placeholder:text-muted-foreground flex w-full rounded-lg border bg-transparent px-3 py-2 text-base transition-colors outline-none md:text-sm resize-none',
              'focus-visible:border-foreground'
            )}
          />
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileChange}
            className="hidden"
            accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
          />

          {formData.attachment ? (
            <div className="flex items-center justify-center gap-2 px-3 py-2 bg-muted rounded-lg w-full sm:w-auto">
              <Paperclip className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="text-sm text-foreground truncate max-w-[150px]">
                {formData.attachment.name}
              </span>
              <button
                type="button"
                onClick={handleRemoveFile}
                className="p-1 hover:bg-background rounded transition-colors"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="w-full sm:w-auto"
            >
              <Paperclip className="h-4 w-4 mr-2" />
              Attach a file
            </Button>
          )}

          <Button
            type="submit"
            size="sm"
            disabled={isLoading}
            className="w-full sm:w-auto"
          >
            {isLoading ? (
              'Sending...'
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                {submitLabel}
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
